import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDb,
  resetTestDb,
} from "@asset-scraping/db/test-helpers";
import {
  dividendEvents,
  dividendSymbols,
  fxRates,
  upsertAccount,
  upsertHoldings,
  type Database,
} from "@asset-scraping/db";
import {
  fetchDividendEvents,
  fetchUsdJpy,
  syncDividends,
  toYahooSymbol,
  upsertDividendSymbol,
  validateDividendMapping,
} from "../src/dividends.js";
import { handleDividendMapping } from "../src/server.js";

/** Yahoo chart JSON の応答を模す */
function chartJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function dividendsBody(currency: string, divs: Record<string, number>): unknown {
  const events =
    Object.keys(divs).length === 0
      ? undefined
      : {
          dividends: Object.fromEntries(
            Object.entries(divs).map(([ts, amount]) => [ts, { amount, date: Number(ts) }]),
          ),
        };
  return { chart: { result: [{ meta: { currency }, events }] } };
}

// ---------------------------------------------------------------------------
// toYahooSymbol
// ---------------------------------------------------------------------------

describe("toYahooSymbol", () => {
  it.each([
    ["7203", { symbol: "7203.T", currency: "JPY" }],
    ["563A", { symbol: "563A.T", currency: "JPY" }],
    ["408A", { symbol: "408A.T", currency: "JPY" }],
    ["314A", { symbol: "314A.T", currency: "JPY" }],
    ["AMD", { symbol: "AMD", currency: "USD" }],
    ["JEPQ", { symbol: "JEPQ", currency: "USD" }],
    ["BRK.B", { symbol: "BRK.B", currency: "USD" }],
  ])("%s → 正しいシンボルと通貨", (input, expected) => {
    expect(toYahooSymbol(input)).toEqual(expected);
  });

  it("解決できないコードは null", () => {
    expect(toYahooSymbol(null)).toBeNull();
    expect(toYahooSymbol("")).toBeNull();
    expect(toYahooSymbol("  ")).toBeNull();
    expect(toYahooSymbol("12345")).toBeNull();
    expect(toYahooSymbol("563a")).toBeNull();
    expect(toYahooSymbol("あいう")).toBeNull();
    expect(toYahooSymbol("12 34")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchDividendEvents / fetchUsdJpy
// ---------------------------------------------------------------------------

describe("fetchDividendEvents", () => {
  afterEach(() => vi.restoreAllMocks());

  it("正常系: 分配イベントの件数と金額を取り出す（KO 形）", async () => {
    const fetchMock = vi.fn(async () =>
      chartJson(
        dividendsBody("USD", { "1700000000": 0.46, "1690000000": 0.44, "1680000000": 0.42 }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDividendEvents("KO");
    expect(result.currency).toBe("USD");
    expect(result.events).toHaveLength(3);
    expect(result.events.map((e) => e.amount)).toEqual([0.42, 0.44, 0.46]);
    expect(result.events[0]!.exDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // User-Agent を付けて自前 HTTP していること
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("Mozilla/5.0");
  });

  it("events が無い（無配）でもエラーにせず {events:[]} を返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chartJson({ chart: { result: [{ meta: { currency: "JPY" } }] } })));
    const result = await fetchDividendEvents("4755.T");
    expect(result.currency).toBe("JPY");
    expect(result.events).toEqual([]);
  });

  it("HTTP 500 は throw する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(fetchDividendEvents("KO")).rejects.toThrow(/500/);
  });

  it("JSON 破損は throw する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    await expect(fetchDividendEvents("KO")).rejects.toThrow();
  });

  it("fetchUsdJpy は regularMarketPrice を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        chartJson({ chart: { result: [{ meta: { regularMarketPrice: 158.183 } }] } }),
      ),
    );
    expect(await fetchUsdJpy()).toBeCloseTo(158.183);
  });
});

// ---------------------------------------------------------------------------
// syncDividends（インメモリ DB）
// ---------------------------------------------------------------------------

describe("syncDividends", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb(":memory:");
    resetTestDb(db);
    db.delete(dividendEvents).run();
    db.delete(dividendSymbols).run();
    db.delete(fxRates).run();
    upsertAccount(db, { id: "acc1", name: "SBI証券", institution: "SBI証券", category: "securities" });
    const scrapedAt = new Date().toISOString();
    upsertHoldings(db, [
      { accountId: "acc1", name: "楽天グループ", code: "4755", quantity: 100, value: 1000, averagePrice: null, unrealizedGain: null, scrapedAt },
      { accountId: "acc1", name: "住友電工", code: "5802", quantity: 100, value: 2000, averagePrice: null, unrealizedGain: null, scrapedAt },
      { accountId: "acc1", name: "無配投信", code: null, quantity: 100, value: 3000, averagePrice: null, unrealizedGain: null, scrapedAt },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function installChartFetch(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("4755.T")) {
          return chartJson(dividendsBody("JPY", { "1700000000": 10, "1690000000": 9 }));
        }
        if (url.includes("5802.T")) {
          return chartJson(dividendsBody("JPY", { "1700000001": 20 }));
        }
        if (url.includes("JPY")) {
          return chartJson({ chart: { result: [{ meta: { regularMarketPrice: 158.183 } }] } });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  }

  it("対象シンボルを直列取得し、dividend_events / fx_rates へ upsert する", async () => {
    installChartFetch();
    const result = await syncDividends(db, { delayMs: 0 });

    expect(result.errors).toEqual([]);
    // 4755.T + 5802.T の 2 シンボル（code=null の投信は対象外）
    expect(result.symbols).toBe(2);
    expect(result.events).toBe(3);
    expect(result.fx).toBeCloseTo(158.183);

    const rows = db.select().from(dividendEvents).all();
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.symbol === "4755.T" && r.exDate === "2023-11-14")?.amount).toBe(10);

    const fx = db.select().from(fxRates).all();
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ pair: "USDJPY" });
    expect(fx[0]!.rate).toBeCloseTo(158.183);
  });

  it("2 回実行しても行数が増えない（冪等）", async () => {
    installChartFetch();
    await syncDividends(db, { delayMs: 0 });
    const first = db.select().from(dividendEvents).all().length;
    await syncDividends(db, { delayMs: 0 });
    const second = db.select().from(dividendEvents).all().length;
    expect(second).toBe(first);
  });

  it("dividend_symbols の手動マッピング行も対象に含める", async () => {
    upsertDividendSymbol(db, { holdingName: "手動ETF", yahooSymbol: "JEPQ", currency: "USD" });
    installChartFetch();
    const result = await syncDividends(db, { delayMs: 0 });
    expect(result.symbols).toBe(3);
  });

  it("1 シンボルの失敗で全体を止めず errors に積む", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("4755.T")) return new Response("nope", { status: 500 });
        if (url.includes("5802.T")) return chartJson(dividendsBody("JPY", { "1700000001": 20 }));
        return chartJson({ chart: { result: [{ meta: { regularMarketPrice: 158 } }] } });
      }),
    );
    const result = await syncDividends(db, { delayMs: 0 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/4755\.T/);
    // 成功した 5802.T のイベントは保存される
    expect(db.select().from(dividendEvents).all()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 手動マッピング（POST /dividends/mapping の検証・upsert）
// ---------------------------------------------------------------------------

describe("validateDividendMapping / handleDividendMapping", () => {
  let db: Database;
  beforeEach(() => {
    db = createTestDb(":memory:");
    resetTestDb(db);
    db.delete(dividendSymbols).run();
  });

  it("正常なボディを受理し、保存後の行を返す（200）", () => {
    const outcome = handleDividendMapping(db, {
      holdingName: "eMAXIS Slim 全世界株式",
      annualDistributionPerUnit: 120,
      paysDistribution: true,
    });
    expect(outcome.status).toBe(200);
    const row = (outcome.body as { row: Record<string, unknown> }).row;
    expect(row.holdingName).toBe("eMAXIS Slim 全世界株式");
    expect(row.annualDistributionPerUnit).toBe(120);
    expect(db.select().from(dividendSymbols).all()).toHaveLength(1);
  });

  it("holdingName が空なら 400", () => {
    expect(handleDividendMapping(db, { holdingName: "" }).status).toBe(400);
    expect(handleDividendMapping(db, { holdingName: "   " }).status).toBe(400);
    expect(handleDividendMapping(db, {}).status).toBe(400);
  });

  it("不正な yahooSymbol は 400、空文字は null として 200", () => {
    expect(handleDividendMapping(db, { holdingName: "A", yahooSymbol: "bad symbol!" }).status).toBe(400);
    expect(handleDividendMapping(db, { holdingName: "A", yahooSymbol: "x".repeat(13) }).status).toBe(400);
    const ok = handleDividendMapping(db, { holdingName: "A", yahooSymbol: "" });
    expect(ok.status).toBe(200);
    expect((ok.body as { row: Record<string, unknown> }).row.yahooSymbol).toBeNull();
  });

  it("annualDistributionPerUnit が負・非数なら 400", () => {
    expect(validateDividendMapping({ holdingName: "A", annualDistributionPerUnit: -1 }).ok).toBe(false);
    expect(validateDividendMapping({ holdingName: "A", annualDistributionPerUnit: Number.NaN }).ok).toBe(false);
    expect(validateDividendMapping({ holdingName: "A", annualDistributionPerUnit: 0 }).ok).toBe(true);
  });

  it("同じ holdingName は upsert で既存行を更新する", () => {
    handleDividendMapping(db, { holdingName: "A", annualDistributionPerUnit: 100 });
    const second = handleDividendMapping(db, { holdingName: "A", annualDistributionPerUnit: 250 });
    expect(second.status).toBe(200);
    const rows = db.select().from(dividendSymbols).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.annualDistributionPerUnit).toBe(250);
  });
});
