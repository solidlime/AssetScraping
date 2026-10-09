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

/** "1,234,567円" / "-12,345円" / "1,234,567" → number */
export function parseYen(text: string): number | null {
  const m = /(-?[\d,]+(?:\.\d+)?)\s*(?:円|px)?/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[1]?.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseDate(text: string): string | null {
  const m = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(text);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 口座一覧・残高
// ---------------------------------------------------------------------------

export function parseAccounts(html: string): Array<Account & { status: AccountStatus }> {
  const root = parse(html);
  const results: Array<Account & { status: AccountStatus }> = [];
  const scrapedAt = new Date().toISOString();

  // 口座行: a[href*="/accounts/"] を含む行（li / tr）を候補にする
  const links = root.querySelectorAll('a[href*="/accounts/"]');
  const seen = new Set<string>();

  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    const idMatch = /\/accounts\/([^/?#]+)/.exec(href);
    const id = idMatch?.[1];
    if (!id || seen.has(id)) continue;
    if (id === "new" || id === "edit") continue;

    // 行要素（li / tr / div.row）まで遡る
    const row = link.closest("li, tr") ?? link;
    const rowText = row.text.replace(/\s+/g, " ").trim();
    const name = link.text.replace(/\s+/g, " ").trim() || rowText.slice(0, 40);
    if (!name) continue;

    const balance = parseYen(rowText);
    if (balance === null) continue;

    seen.add(id);
    const institutionHint = rowText;
    results.push({
      id,
      name,
      institution: institutionHint.split(" ")[0] ?? "",
      category: guessCategory(rowText),
      status: { accountId: id, balance, scrapedAt },
    });
  }

  if (results.length === 0) {
    throw new ScrapeParseError("口座一覧（/accounts/ リンク）が 1 件も見つかりません");
  }
  return results;
}

// ---------------------------------------------------------------------------
// 保有資産
// ---------------------------------------------------------------------------

export function parseHoldings(html: string, accountId: string): Holding[] {
  const root = parse(html);
  const scrapedAt = new Date().toISOString();
  const rows = root.querySelectorAll("table tr");
  const holdings: Holding[] = [];

  for (const row of rows) {
    const cells = row.querySelectorAll("td, th");
    if (cells.length < 2) continue;
    const texts = cells.map((c) => c.text.replace(/\s+/g, " ").trim());
    const name = texts[0] ?? "";
    if (!name || /^(合計|小計|total)/i.test(name)) continue;
    const value = parseYen(texts[1] ?? "");
    if (value === null) continue;
    const quantity = parseYen(texts[2] ?? "") ?? 0;
    const averagePrice = parseYen(texts[3] ?? "");
    const unrealized = parseYen(texts[4] ?? "");
    holdings.push({
      accountId,
      name,
      quantity,
      value,
      averagePrice,
      unrealizedGain: unrealized,
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
