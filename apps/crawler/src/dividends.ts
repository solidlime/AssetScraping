/**
 * 配当・分配シミュレータ (F6) のデータ取得層。
 *
 * データ源は Yahoo Finance chart API（自前 HTTP。MCP hub 非依存）:
 *   https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?events=div&range=3y&interval=1d
 * 実測: KO=USD 8件 / 9432.T=JPY 6件 / 4755.T=0件（楽天は無配＝正常）/
 *       JEPQ=USD 24件（毎月分配・金額変動）/ JEPI=USD 12件。
 * 為替: JPY=X の meta.regularMarketPrice。
 *
 * DB 書き込みは crawler が唯一の writer。web は proxy 経由で触る。
 */
import { eq, isNotNull } from "drizzle-orm";
import {
  dividendEvents,
  dividendSymbols,
  fxRates,
  holdings,
  type Db,
} from "@asset-scraping/db";
import { toYahooSymbol, type YahooSymbolResolution } from "@asset-scraping/shared";

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const USER_AGENT = "Mozilla/5.0";
const TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// シンボル解決
// ---------------------------------------------------------------------------

/** 後方互換: 解決ロジックは @asset-scraping/shared に集約（実装は toYahooSymbol を参照） */
export { toYahooSymbol };
export type YahooResolution = YahooSymbolResolution;

// ---------------------------------------------------------------------------
// Yahoo chart 取得
// ---------------------------------------------------------------------------

export type DividendEventRow = { exDate: string; amount: number };

interface YahooDividend {
  amount?: number;
  date?: number;
}
interface YahooChartResult {
  meta?: { currency?: string; regularMarketPrice?: number };
  events?: { dividends?: Record<string, YahooDividend> };
}
interface YahooChartResponse {
  chart?: { result?: YahooChartResult[] };
}

async function fetchChart(symbol: string, query: string): Promise<YahooChartResponse> {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?${query}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Yahoo chart ${symbol}: HTTP ${res.status}`);
  // JSON 破損はここで throw する（呼び出し元で errors に積む）
  return (await res.json()) as YahooChartResponse;
}

/**
 * 配当・分配イベントを取得する。`events` が無い/空でもエラーにしない（無配は正常）。
 * HTTP 4xx/5xx と JSON 破損は throw。権利落ち日 (exDate) 昇順で返す。
 */
export async function fetchDividendEvents(
  symbol: string,
): Promise<{ currency: string; events: DividendEventRow[] }> {
  const json = await fetchChart(symbol, "events=div&range=3y&interval=1d");
  const result = json.chart?.result?.[0];
  const currency = result?.meta?.currency ?? "";
  const divs = result?.events?.dividends ?? {};
  const events: DividendEventRow[] = [];
  for (const d of Object.values(divs)) {
    if (!d || typeof d.amount !== "number" || !Number.isFinite(d.amount)) continue;
    const date = Number(d.date);
    if (!Number.isFinite(date)) continue;
    events.push({ exDate: new Date(date * 1000).toISOString().slice(0, 10), amount: d.amount });
  }
  events.sort((a, b) => a.exDate.localeCompare(b.exDate));
  return { currency, events };
}

/** USD/JPY レート。取得できなければ null（同期全体は止めない）。 */
export async function fetchUsdJpy(): Promise<number | null> {
  try {
    const json = await fetchChart("JPY=X", "range=1d&interval=1d");
    const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" && Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 同期
// ---------------------------------------------------------------------------

export type SyncResult = { symbols: number; events: number; fx: number | null; errors: string[] };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** holdings.code + dividend_symbols.yahoo_symbol から取得対象を重複なく導出する */
function collectTargetSymbols(db: Db): string[] {
  const symbols = new Set<string>();
  for (const row of db
    .select({ code: holdings.code })
    .from(holdings)
    .where(isNotNull(holdings.code))
    .all()) {
    const res = toYahooSymbol(row.code);
    if (res) symbols.add(res.symbol);
  }
  for (const row of db
    .select({ symbol: dividendSymbols.yahooSymbol })
    .from(dividendSymbols)
    .where(isNotNull(dividendSymbols.yahooSymbol))
    .all()) {
    if (row.symbol) symbols.add(row.symbol);
  }
  return [...symbols];
}

function upsertDividendEvent(
  db: Db,
  row: { symbol: string; exDate: string; amount: number; currency: string; fetchedAt: string },
): void {
  db.insert(dividendEvents)
    .values(row)
    .onConflictDoUpdate({
      target: [dividendEvents.symbol, dividendEvents.exDate],
      set: { amount: row.amount, currency: row.currency, fetchedAt: row.fetchedAt },
    })
    .run();
}

/**
 * 解決済みシンボルを直列に取得し、dividend_events / fx_rates へ冪等 upsert する。
 * 1 シンボルの失敗で全体を止めず、`errors` に `symbol: message` を積んで継続する。
 */
export async function syncDividends(db: Db, opts?: { delayMs?: number }): Promise<SyncResult> {
  const delayMs = opts?.delayMs ?? 300;
  const targets = collectTargetSymbols(db);
  const fetchedAt = new Date().toISOString();
  const result: SyncResult = { symbols: targets.length, events: 0, fx: null, errors: [] };

  for (let i = 0; i < targets.length; i++) {
    const symbol = targets[i]!;
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    try {
      const { currency, events } = await fetchDividendEvents(symbol);
      for (const e of events) {
        upsertDividendEvent(db, {
          symbol,
          exDate: e.exDate,
          amount: e.amount,
          currency: currency || "USD",
          fetchedAt,
        });
        result.events++;
      }
    } catch (err) {
      result.errors.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const rate = await fetchUsdJpy();
  if (rate !== null) {
    db.insert(fxRates)
      .values({ pair: "USDJPY", rate, fetchedAt })
      .onConflictDoUpdate({ target: fxRates.pair, set: { rate, fetchedAt } })
      .run();
    result.fx = rate;
  }

  return result;
}

// ---------------------------------------------------------------------------
// 手動マッピング（POST /dividends/mapping）
// ---------------------------------------------------------------------------

export interface DividendMappingInput {
  holdingName: string;
  yahooSymbol: string | null;
  currency: "USD" | "JPY" | null;
  annualDistributionPerUnit: number | null;
  paysDistribution: boolean;
  note: string | null;
}

export type DividendSymbolRow = typeof dividendSymbols.$inferSelect;

const YAHOO_SYMBOL_RE = /^[A-Z0-9.\-^=]{1,12}$/;

/** マッピングボディの検証。不正は `{ ok:false, error }`（呼び出し元が 400 にする）。 */
export function validateDividendMapping(
  body: unknown,
):
  | { ok: true; value: DividendMappingInput }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body はオブジェクトで指定してください" };
  const b = body as Record<string, unknown>;

  const holdingName = typeof b.holdingName === "string" ? b.holdingName.trim() : "";
  if (!holdingName) return { ok: false, error: "holdingName は必須です" };

  // yahooSymbol: undefined / null / 空文字 は null 扱い。それ以外は形式チェック
  let yahooSymbol: string | null = null;
  if (b.yahooSymbol !== undefined && b.yahooSymbol !== null && b.yahooSymbol !== "") {
    if (typeof b.yahooSymbol !== "string" || !YAHOO_SYMBOL_RE.test(b.yahooSymbol)) {
      return { ok: false, error: "yahooSymbol の形式が不正です" };
    }
    yahooSymbol = b.yahooSymbol;
  }

  let currency: "USD" | "JPY" | null = null;
  if (b.currency !== undefined && b.currency !== null) {
    if (b.currency !== "USD" && b.currency !== "JPY") {
      return { ok: false, error: "currency は USD|JPY|null で指定してください" };
    }
    currency = b.currency;
  }

  let annualDistributionPerUnit: number | null = null;
  if (b.annualDistributionPerUnit !== undefined && b.annualDistributionPerUnit !== null) {
    if (
      typeof b.annualDistributionPerUnit !== "number" ||
      !Number.isFinite(b.annualDistributionPerUnit) ||
      b.annualDistributionPerUnit < 0
    ) {
      return { ok: false, error: "annualDistributionPerUnit は 0 以上の有限数で指定してください" };
    }
    annualDistributionPerUnit = b.annualDistributionPerUnit;
  }

  let paysDistribution = true;
  if (b.paysDistribution !== undefined && b.paysDistribution !== null) {
    if (typeof b.paysDistribution !== "boolean") {
      return { ok: false, error: "paysDistribution は boolean で指定してください" };
    }
    paysDistribution = b.paysDistribution;
  }

  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string") return { ok: false, error: "note は文字列で指定してください" };
    note = b.note;
  }

  return {
    ok: true,
    value: { holdingName, yahooSymbol, currency, annualDistributionPerUnit, paysDistribution, note },
  };
}

/**
 * dividend_symbols を holding_name で冪等 upsert し、保存後の行を返す。
 * 未指定フィールドは null / 既定値で上書きする（部分更新ではなく全置換）。
 */
export function upsertDividendSymbol(db: Db, input: DividendMappingInput): DividendSymbolRow {
  const ts = new Date().toISOString();
  db.insert(dividendSymbols)
    .values({
      holdingName: input.holdingName,
      yahooSymbol: input.yahooSymbol,
      currency: input.currency,
      annualDistributionPerUnit: input.annualDistributionPerUnit,
      paysDistribution: input.paysDistribution,
      note: input.note,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: dividendSymbols.holdingName,
      set: {
        yahooSymbol: input.yahooSymbol,
        currency: input.currency,
        annualDistributionPerUnit: input.annualDistributionPerUnit,
        paysDistribution: input.paysDistribution,
        note: input.note,
        updatedAt: ts,
      },
    })
    .run();
  return db
    .select()
    .from(dividendSymbols)
    .where(eq(dividendSymbols.holdingName, input.holdingName))
    .get()!;
}
