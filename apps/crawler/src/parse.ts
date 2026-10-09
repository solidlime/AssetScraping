/**
 * ssnb SSR HTML のパーサ群（2026-10 実測の HTML 構造に準拠）。
 *
 * 解析対象はテーブル実測構造:
 * - /accounts            口座一覧テーブル（各行 td[0]=口座リンク, td[1]=残高）
 * - /accounts/show/{id}  「種類・名称」ヘッダの残高内訳テーブル
 * - /bs/history          資産推移テーブル（th=日付, td=金額, ヘッダ th=カテゴリ）
 * - /cf                  table-hover の取引明細テーブル
 * 解釈できない場合は例外（空データを黙って書かない）。ただし残高内訳テーブルが
 * 存在しない口座は正常な空配列を返す。
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

/** セルテキストの正規化（改行・複数空白 → 単一空白、前後空白トリム） */
function cellText(cell: { text: string } | null | undefined): string {
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

/**
 * /bs/history の列ヘッダ → AccountCategory 対応（実測 2026-10）。
 * AccountCategory に無い列（合計・詳細・日付）は null = skip。
 * 型上の制約で 株式(現物)/投資信託、債券/FX は同カテゴリに丸める（行内で加算して合算）。
 */
const HISTORY_COLUMN_CATEGORY: Array<[string, AccountCategory | null]> = [
  ["預金・現金", "bank"],
  ["株式(現物)", "securities"],
  ["投資信託", "securities"],
  ["債券", "other"],
  ["暗号資産", "crypto"],
  ["FX", "other"],
  ["年金", "pension"],
  ["ポイント", "point"],
  ["合計", null],
  ["詳細", null],
  ["日付", null],
];

/** 列ヘッダテキストを正規化（全角括弧 → 半角）して表引きキーにする */
function headerKey(text: string): string {
  return text.replace(/[（）]/g, (c) => (c === "（" ? "(" : ")")).trim();
}

/**
 * 資産推移（/bs/history の table[0]）を parse する。実測（2026-10）:
 * - ヘッダ行 th: 日付/合計/預金・現金/…/ポイント/詳細
 * - 各行: th=日付（ISO そのまま）、td=金額（"46,604,121円"、列順はヘッダに対応、最終 td=詳細リンク）
 */
export function parseAssetHistory(html: string): AssetHistoryPoint[] {
  const root = parse(html);
  const table = root
    .querySelectorAll("table")
    .find((t) =>
      t.querySelectorAll("th").some((th) => headerKey(cellText(th)) === "日付"),
    );
  if (!table) throw new ScrapeParseError("資産推移テーブル（日付ヘッダ行）が見つかりません");

  const headerRow = table
    .querySelectorAll("tr")
    .find((tr) => tr.querySelectorAll("td").length === 0);
  if (!headerRow) throw new ScrapeParseError("資産推移テーブルのヘッダ行が見つかりません");
  const headerCells = headerRow.querySelectorAll("th");
  if (headerCells.length === 0) {
    throw new ScrapeParseError("資産推移テーブルのヘッダ行が th で構成されていません");
  }
  const columns = headerCells.map((th) => {
    const key = headerKey(cellText(th));
    return HISTORY_COLUMN_CATEGORY.find(([name]) => name === key)?.[1] ?? null;
  });

  const points: AssetHistoryPoint[] = [];
  for (const row of table.querySelectorAll("tr")) {
    const date = parseDate(cellText(row.querySelector("th")));
    if (!date) continue; // ヘッダ行・日付不明行は skip
    // 同一カテゴリ列（株式/投信、債券/FX 等）は行内で加算して合算する
    const byCategory = new Map<AccountCategory, number>();
    const tds = row.querySelectorAll("td");
    for (let i = 0; i < columns.length; i++) {
      const category = columns[i];
      if (!category) continue;
      const value = parseYen(cellText(tds[i - 1]));
      if (value === null) continue; // 「詳細」リンク等の非金額セル
      byCategory.set(category, (byCategory.get(category) ?? 0) + value);
    }
    for (const [category, value] of byCategory) {
      points.push({ date, category, value });
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// 取引履歴
// ---------------------------------------------------------------------------

/**
 * 取引明細（/cf の table-hover テーブル）を parse する。実測（2026-10）:
 * - th ヘッダ: 計算対象/日付/内容/金額（円）/保有金融機関/大項目/中項目/…
 * - td: [0]=checkbox、[1]=日付 "10/02(金)"、[2]=内容、[3]=金額（"-22,000\n(振替)"、負値=出金）、[5]=大項目、[6]=中項目
 * - 取引 ID リンクは無い（externalId = null）。常に当月分のみ。
 */
export function parseTransactions(html: string, accountId: string, now: Date = new Date()): Transaction[] {
  const root = parse(html);
  const table = root
    .querySelectorAll("table")
    .find((t) => {
      const ths = t.querySelectorAll("th").map((th) => cellText(th));
      return ths.includes("日付") && ths.some((s) => s.startsWith("金額"));
    });
  if (!table) throw new ScrapeParseError("取引明細テーブル（日付/金額ヘッダ行）が見つかりません");

  const headerRow = table.querySelectorAll("tr").find((tr) => tr.querySelectorAll("td").length === 0);
  if (!headerRow) throw new ScrapeParseError("取引明細テーブルのヘッダ行が見つかりません");
  const header = headerRow.querySelectorAll("th").map((th) => headerKey(cellText(th)));
  const idx = (name: string) => header.indexOf(name);
  const dateIdx = idx("日付");
  const descIdx = idx("内容");
  const amountIdx = header.findIndex((s) => s.startsWith("金額"));
  const majorIdx = idx("大項目");
  const minorIdx = idx("中項目");

  const txs: Transaction[] = [];
  for (const row of table.querySelectorAll("tr")) {
    const tds = row.querySelectorAll("td");
    if (tds.length < 3) continue;
    const date = parseDate(cellText(tds[dateIdx]), now);
    if (!date) continue;
    const description = cellText(tds[descIdx]);
    if (!description) continue;
    // 金額セル: "-22,000\n(振替)" → -22000（(振替) 付与・負値は維持）
    const amount = parseYenLoose(cellText(tds[amountIdx]).replace(/\(振替\)/g, ""));
    if (amount === null) continue;
    const major = cellText(tds[majorIdx]);
    const minor = cellText(tds[minorIdx]);
    const category = [major, minor].filter(Boolean).join(" / ") || null;
    txs.push({ externalId: null, accountId, date, description, amount, category });
  }
  return txs;
}

export { ACCOUNT_CATEGORIES };
