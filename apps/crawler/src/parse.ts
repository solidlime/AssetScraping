/**
 * ssnb SSR HTML のパーサ群。
 *
 * ⚠️ 未実測: ssnb の実際の HTML 構造は最初の実スクレイプまで確定しない。
 * セレクタはデータ属性・テーブル構造・見出しテキストの順にフォールバックし、
 * 1つも解釈できなかった場合は例外（空データを黙って書かない）。
 */
import type {
  Account,
  AccountCategory,
  AccountStatus,
  AssetHistoryPoint,
  Holding,
  Transaction,
} from "@asset-scraping/shared";
import { ACCOUNT_CATEGORIES } from "@asset-scraping/shared";
import { parse } from "node-html-parser";

export class ScrapeParseError extends Error {
  constructor(what: string) {
    super(`スクレイプ結果のパースに失敗しました: ${what}（ssnb の HTML 構造が想定と異なる可能性があります）`);
    this.name = "ScrapeParseError";
  }
}

const CATEGORY_KEYWORDS: Array<[AccountCategory, string[]]> = [
  ["bank", ["銀行", "預金", "普通", "定期"]],
  ["securities", ["証券", "投信", "投資信託", "株", "ETF"]],
  ["cash", ["現金", "wallet"]],
  ["point", ["ポイント"]],
  ["crypto", ["暗号資産", "仮想通貨", "bitcoin"]],
  ["pension", ["年金", "iDeCo", "ideco"]],
  ["real_estate", ["不動産"]],
];

export function guessCategory(text: string): AccountCategory {
  for (const [cat, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => text.includes(k))) return cat;
  }
  return "other";
}

/** "1,234,567円" / "-12,345円" → number。円表記が必須（日付・カレンダー数字の誤爆防止）。 */
export function parseYen(text: string): number | null {
  const m = /(-?\d[\d,]*(?:\.\d+)?)円/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[1]?.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 円表記なしの数値（取引明細金額 "-22,000\n(振替)" 等）。最初の数値トークンを返す。
 * 日付・カテゴリ等の非金額セルは呼び出し側で選んで渡すこと。
 */
export function parseYenLoose(text: string): number | null {
  const m = /(-?\d[\d,]*(?:\.\d+)?)/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[1]?.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseDate(text: string, now: Date = new Date()): string | null {
  const iso = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(text);
  if (iso) {
    const [, y, mo, d] = iso;
    return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  // 実測: 取引明細の日付は "10/02(金)"（年なし、当月=当年）
  const md = /(\d{1,2})\/(\d{1,2})/.exec(text);
  if (md) {
    const mo = Number(md[1]);
    const d = Number(md[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${now.getFullYear()}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 口座一覧・残高
// ---------------------------------------------------------------------------

/** セルテキストの正規化（改行・複数空白 → 単一空白、前後平方トリム） */
function cellText(cell: { text: string } | undefined): string {
  return cell ? cell.text.replace(/\s+/g, " ").trim() : "";
}

/**
 * 口座一覧（/accounts の構造化テーブル）を parse する。実測（2026-10）:
 * - 各行 td[0] に a[href="/accounts/show/{id}"]（金融機関名テキスト）、td[1] に残高（"35円" 形式）
 */
export function parseAccounts(html: string): Array<Account & { status: AccountStatus }> {
  const root = parse(html);
  const results: Array<Account & { status: AccountStatus }> = [];
  const scrapedAt = new Date().toISOString();
  const seen = new Set<string>();

  for (const link of root.querySelectorAll('a[href*="/accounts/show/"]')) {
    const href = link.getAttribute("href") ?? "";
    const id = /\/accounts\/show\/([^/?#]+)/.exec(href)?.[1];
    if (!id || seen.has(id)) continue;

    const row = link.closest("tr");
    const tds = row ? row.querySelectorAll("td") : [];
    if (tds.length < 2) continue;
    const name = cellText(tds[0]);
    const balance = parseYen(cellText(tds[1]));
    if (!name || balance === null) continue;

    seen.add(id);
    results.push({
      id,
      name,
      institution: cellText(link) || name,
      category: guessCategory(name),
      status: { accountId: id, balance, scrapedAt },
    });
  }

  if (results.length === 0) {
    throw new ScrapeParseError("口座一覧テーブル（/accounts/show/ リンク付き行）が 1 件も見つかりません");
  }
  return results;
}

// ---------------------------------------------------------------------------
// 保有資産
// ---------------------------------------------------------------------------

/**
 * 口座別残高内訳（/accounts/show/{id}、「種類・名称」ヘッダのテーブルのみ）を parse する。
 * 実測（2026-10）: th ヘッダ「種類・名称 / 残高」、各行 [名称, "35円"]。数量・単価・含み損益は取れない。
 * 対象テーブルが無い（現金口座など）場合は空配列。
 */
export function parseHoldings(html: string, accountId: string): Holding[] {
  const root = parse(html);
  const scrapedAt = new Date().toISOString();
  const table = root
    .querySelectorAll("table")
    .find((t) =>
      t.querySelectorAll("th").some((th) => cellText(th) === "種類・名称"),
    );
  if (!table) return [];

  const holdings: Holding[] = [];
  for (const row of table.querySelectorAll("tr")) {
    const tds = row.querySelectorAll("td");
    if (tds.length < 2) continue;
    const name = cellText(tds[0]);
    if (!name || /^(合計|小計|total)/i.test(name)) continue;
    const value = parseYen(cellText(tds[1]));
    if (value === null) continue;
    holdings.push({
      accountId,
      name,
      quantity: 0,
      value,
      averagePrice: null,
      unrealizedGain: null,
      scrapedAt,
    });
  }
  return holdings;
}

// ---------------------------------------------------------------------------
// 資産推移
// ---------------------------------------------------------------------------

export function parseAssetHistory(html: string): AssetHistoryPoint[] {
  const root = parse(html);
  const points: AssetHistoryPoint[] = [];
  const rows = root.querySelectorAll("table tr");

  for (const row of rows) {
    const cells = row.querySelectorAll("td, th");
    if (cells.length < 2) continue;
    const texts = cells.map((c) => c.text.replace(/\s+/g, " ").trim());
    const date = parseDate(texts[0] ?? "");
    if (!date) continue;
    for (let i = 1; i < cells.length; i++) {
      const value = parseYen(texts[i] ?? "");
      if (value === null) continue;
      const category = guessCategory(
        row.querySelectorAll("th")[i]?.text ?? texts[i] ?? "",
      );
      points.push({ date, category, value });
    }
  }

  return points;
}

// ---------------------------------------------------------------------------
// 取引履歴
// ---------------------------------------------------------------------------

export function parseTransactions(html: string, accountId: string): Transaction[] {
  const root = parse(html);
  const txs: Transaction[] = [];
  const rows = root.querySelectorAll("table tr");

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 3) continue;
    const texts = cells.map((c) => c.text.replace(/\s+/g, " ").trim());
    const date = parseDate(texts[0] ?? "");
    if (!date) continue;
    const description = texts[1] ?? "";
    if (!description) continue;
    const amount = parseYen(texts[2] ?? "");
    if (amount === null) continue;
    const category = texts[3] || null;
    const link = row.querySelector('a[href*="/transactions/"]');
    const externalId = /\/transactions\/(\d+)/.exec(link?.getAttribute("href") ?? "")?.[1] ?? null;
    txs.push({ externalId, accountId, date, description, amount, category });
  }

  return txs;
}

export { ACCOUNT_CATEGORIES };
