/**
 * 配当・分配シミュレータ推定ロジック（packages/db/src/queries/dividends.ts）の統合テスト。
 *
 * better-sqlite3 in-memory DB にマイグレーションを適用し、
 * holdings / holding_values / dividend_symbols / dividend_events / fx_rates を
 * シードして getDividendForecast の数値を固定する。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema.ts";
import { upsertGroup } from "../src/repositories/groups.ts";
import { upsertAccount } from "../src/repositories/accounts.ts";
import { createSnapshot } from "../src/repositories/snapshots.ts";
import { createHolding, saveHoldingValue } from "../src/repositories/holdings.ts";
import { getOrCreateCategory } from "../src/repositories/categories.ts";
import {
  getDividendEvents,
  getDividendForecast,
  getDividendMappings,
  getFxRate,
  normalizeHoldingName,
} from "../src/queries/dividends.ts";

type DB = BetterSQLite3Database<typeof schema>;

const here = fileURLToPath(new URL("..", import.meta.url));

const dbs: DB[] = [];
function freshDb(): DB {
  const sqlite = new BetterSqlite3(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: `${here}/drizzle` });
  dbs.push(db);
  return db;
}

afterAll(() => {
  for (const db of dbs) {
    const sqlite = (db as unknown as { $client: BetterSqlite3.Database }).$client;
    sqlite.close();
  }
});

const NOW = "2026-02-14T06:30:00.000Z";
const NOW_DATE = new Date(NOW);
const SCRAPED_AT = "2026-02-14T00:00:00.000Z";

/** group / account / snapshot を1回だけ用意する */
function seedBase(db: DB): { accountId: string; snapshotId: number } {
  upsertGroup(db, { id: "0", name: "グループ選択なし", isCurrent: true });
  const accountId = upsertAccount(db, {
    mfId: "acc-1",
    name: "SBI証券",
    type: "自動連携",
    status: "ok",
    lastUpdated: "02/14 06:21",
    url: "",
    totalAssets: 0,
  });
  const snapshotId = createSnapshot(db, "0", "2026-02-14", null, { accountId, balance: 0 });
  return { accountId, snapshotId };
}

function seedHolding(
  db: DB,
  accountId: string,
  snapshotId: number,
  categoryName: string,
  name: string,
  opts: { quantity: number; value: number; code?: string | null },
): void {
  const categoryId = getOrCreateCategory(db, categoryName);
  const holdingId = createHolding(db, accountId, name, "asset", {
    categoryId,
    code: opts.code ?? null,
    quantity: opts.quantity,
    value: opts.value,
    scrapedAt: SCRAPED_AT,
  });
  saveHoldingValue(db, holdingId, snapshotId, { amount: opts.value, quantity: opts.quantity });
}

function seedFx(db: DB, pair: string, rate: number): void {
  db.insert(schema.fxRates)
    .values({ pair, rate, fetchedAt: NOW })
    .run();
}

function seedEvent(db: DB, symbol: string, exDate: string, amount: number, currency: string): void {
  db.insert(schema.dividendEvents)
    .values({ symbol, exDate, amount, currency, fetchedAt: NOW })
    .run();
}

describe("normalizeHoldingName", () => {
  it("重複サフィックス _2/_3 と括弧注記を除去する", () => {
    expect(normalizeHoldingName("バンガード 米国高配当株式ETF（株式）_2")).toBe(
      "バンガード 米国高配当株式ETF",
    );
    expect(normalizeHoldingName("eMAXIS Slim 全世界株式_3")).toBe("eMAXIS Slim 全世界株式");
    expect(normalizeHoldingName("コカ-コーラ")).toBe("コカ-コーラ");
    // _1 は重複サフィックスではないので残す
    expect(normalizeHoldingName("テスト_1")).toBe("テスト_1");
  });
});

describe("getDividendForecast", () => {
  it("実データ形のシードに対して株式・ETF・投信・未解決を正しく推定する", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);

    seedFx(db, "USDJPY", 158);

    // 株式: コカ-コーラ（KO）q=300 / value=4,079,196
    seedHolding(db, accountId, snapshotId, "株式(現物)", "コカ-コーラ", {
      quantity: 300,
      value: 4_079_196,
      code: "KO",
    });
    // KO は四半期配当 4件 × 0.51 USD（過去1年）
    for (const exDate of ["2025-03-14", "2025-06-13", "2025-09-12", "2025-12-12"]) {
      seedEvent(db, "KO", exDate, 0.51, "USD");
    }

    // カバコETF: JEPQ q=550 / value=5,339,190、毎月分配12件（0.4〜0.7）
    seedHolding(db, accountId, snapshotId, "株式(現物)", "JPM NDAQ エクイティプレミア インカム ETF", {
      quantity: 550,
      value: 5_339_190,
      code: "JEPQ",
    });
    const jepqAmounts = [0.6, 0.62, 0.64, 0.66, 0.68, 0.7, 0.4, 0.42, 0.44, 0.46, 0.48, 0.5];
    const jepqMonths = [
      "2025-03",
      "2025-04",
      "2025-05",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ];
    jepqMonths.forEach((m, i) => seedEvent(db, "JEPQ", `${m}-01`, jepqAmounts[i]!, "USD"));

    // 投信: iTrustインド株式 q=97680 / value=212,571、年間分配金 0 を設定
    seedHolding(db, accountId, snapshotId, "投資信託", "iTrustインド株式", {
      quantity: 97_680,
      value: 212_571,
      code: null,
    });
    db.insert(schema.dividendSymbols)
      .values({ holdingName: "iTrustインド株式", annualDistributionPerUnit: 0 })
      .run();

    // 未解決: GXNDXカバコ（code=null, dividend_symbols 未登録）
    seedHolding(db, accountId, snapshotId, "投資信託", "GXNDXカバコ", {
      quantity: 700,
      value: 500_000,
      code: null,
    });

    const forecast = await getDividendForecast(db, { now: NOW_DATE });

    expect(forecast.fxUsdJpy).toBe(158);

    const byName = new Map(forecast.rows.map((r) => [r.holdingName, r]));

    // 株式: KO
    const ko = byName.get("コカ-コーラ")!;
    expect(ko.resolved).toBe(true);
    expect(ko.currency).toBe("USD");
    expect(ko.yahooSymbol).toBe("KO");
    expect(ko.perShareTtm).toBeCloseTo(2.04, 10);
    expect(ko.annualAmountJpy).toBe(96_696); // round(2.04 × 300 × 158)
    expect(ko.yieldPct).toBeCloseTo(2.37, 2);

    // ETF: JEPQ（TTM=6.6、直近3ヶ月平均=0.48）
    const jepq = byName.get("JPM NDAQ エクイティプレミア インカム ETF")!;
    expect(jepq.resolved).toBe(true);
    expect(jepq.yahooSymbol).toBe("JEPQ");
    expect(jepq.perShareTtm).toBeCloseTo(6.6, 10);
    expect(jepq.perShareMonthlyAvg).toBeCloseTo(0.48, 10);
    expect(jepq.annualAmountJpy).toBe(573_540); // round(6.6 × 550 × 158)
    expect(jepq.monthlyAmountJpy).toBe(41_712); // round(0.48 × 550 × 158)

    // 投信: 分配金 0（未解決ではない）
    const trust = byName.get("iTrustインド株式")!;
    expect(trust.resolved).toBe(true);
    expect(trust.annualAmountJpy).toBe(0);
    expect(trust.monthlyAmountJpy).toBe(0);
    expect(trust.perShareTtm).toBeNull();

    // 未解決: GXNDXカバコ
    const gx = byName.get("GXNDXカバコ")!;
    expect(gx.resolved).toBe(false);
    expect(gx.reason).toBe("シンボル未解決");
    expect(forecast.unresolved).toEqual([
      { holdingName: "GXNDXカバコ", category: "投資信託", reason: "シンボル未解決" },
    ]);

    // 合計（未解決は算入しない）: 96,696 + 573,540 = 670,236
    expect(forecast.next12MonthsJpy).toBe(670_236);

    // 月別バケット: 過去12ヶ月＋今後12ヶ月 = 24
    expect(forecast.months).toHaveLength(24);
    expect(forecast.months[0]!.month).toBe("2025-03");
    expect(forecast.months[11]!.month).toBe("2026-02");
    expect(forecast.months[11]!.amountJpy).toBe(43_450); // JEPQ 0.5 × 550 × 158
    expect(forecast.months[11]!.confirmed).toBe(true);
    expect(forecast.months[12]!.month).toBe("2026-03");
    expect(forecast.months[12]!.amountJpy).toBe(49_770); // 8,058 + 41,712
    expect(forecast.months[12]!.confirmed).toBe(false);

    // 当月: 実イベント = JEPQ 0.5 × 550 × 158 = 43,450。推定 = KO のみ（JEPQ は当月実績あり）
    expect(forecast.currentMonth).toMatchObject({
      month: "2026-02",
      confirmedJpy: 43_450,
      estimatedJpy: 8_058,
      totalJpy: 51_508,
    });

    // 当年: 2026年実績 85,162 + 残り10ヶ月 × 月次見込み 49,770
    expect(forecast.thisYearJpy).toBe(582_862);
    // 昨年: 2025年実績（現在数量で近似）= KO 96,696 + JEPQ 488,378
    expect(forecast.lastYearJpy).toBe(585_074);
  });

  it("為替レート欠落時は外貨銘柄を未解決扱いにして合計に入れない", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);

    // fx_rates は空
    seedHolding(db, accountId, snapshotId, "株式(現物)", "コカ-コーラ", {
      quantity: 300,
      value: 4_079_196,
      code: "KO",
    });
    seedEvent(db, "KO", "2025-12-12", 0.51, "USD");

    // JPY 銘柄（4桁コード → .T / JPY）
    seedHolding(db, accountId, snapshotId, "株式(現物)", "日本電信電話", {
      quantity: 10,
      value: 1_500_000,
      code: "9432",
    });
    seedEvent(db, "9432.T", "2025-12-01", 100, "JPY");

    const forecast = await getDividendForecast(db, { now: NOW_DATE });

    expect(forecast.fxUsdJpy).toBeNull();
    const ko = forecast.rows.find((r) => r.holdingName === "コカ-コーラ")!;
    expect(ko.resolved).toBe(false);
    expect(ko.reason).toBe("為替レート未取得");
    expect(forecast.unresolved).toContainEqual({
      holdingName: "コカ-コーラ",
      category: "株式(現物)",
      reason: "為替レート未取得",
    });

    const jp = forecast.rows.find((r) => r.holdingName === "日本電信電話")!;
    expect(jp.resolved).toBe(true);
    expect(jp.yahooSymbol).toBe("9432.T");
    expect(jp.currency).toBe("JPY");
    expect(jp.annualAmountJpy).toBe(1000); // 100 × 10 × 1

    // 未解決の KO は合計に入らない（JPY のみ）
    expect(forecast.next12MonthsJpy).toBe(1000);
  });

  it("当月に ex-date がある銘柄を月次見込みに二重計上しない", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);

    seedHolding(db, accountId, snapshotId, "株式(現物)", "コカ-コーラ", {
      quantity: 300,
      value: 4_079_196,
      code: "KO",
    });
    // 当月（2026-02）のみイベント
    seedEvent(db, "KO", "2026-02-10", 1.0, "USD");

    const forecast = await getDividendForecast(db, { now: NOW_DATE });

    // confirmed = 1.0 × 300 × 158 = 47,400
    expect(forecast.currentMonth.confirmedJpy).toBe(47_400);
    // 当月実績がある銘柄は estimated に加算しない → 0
    expect(forecast.currentMonth.estimatedJpy).toBe(0);
    expect(forecast.currentMonth.totalJpy).toBe(47_400);
  });

  it("同一基底名の holdings は合算する", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);

    seedHolding(db, accountId, snapshotId, "株式(現物)", "バンガード 米国高配当株式ETF（株式）_2", {
      quantity: 100,
      value: 1_000_000,
      code: null,
    });
    seedHolding(db, accountId, snapshotId, "株式(現物)", "バンガード 米国高配当株式ETF", {
      quantity: 50,
      value: 500_000,
      code: "VYM",
    });

    const forecast = await getDividendForecast(db, { now: NOW_DATE });
    const row = forecast.rows.find((r) => r.holdingName === "バンガード 米国高配当株式ETF")!;
    expect(row.quantity).toBe(150);
    expect(row.value).toBe(1_500_000);
    expect(row.code).toBe("VYM"); // 非 null を採用
    expect(row.resolved).toBe(true);
    expect(row.yahooSymbol).toBe("VYM");
  });
});

describe("dividend 補助クエリ", () => {
  it("getDividendEvents / getFxRate / getDividendMappings が基本動作する", async () => {
    const db = freshDb();
    seedFx(db, "USDJPY", 158);
    seedEvent(db, "KO", "2025-12-12", 0.51, "USD");
    seedEvent(db, "KO", "2025-06-13", 0.51, "USD");
    seedEvent(db, "JEPQ", "2026-01-01", 0.48, "USD");
    db.insert(schema.dividendSymbols)
      .values({
        holdingName: "iTrustインド株式",
        yahooSymbol: null,
        currency: "JPY",
        annualDistributionPerUnit: 120,
        paysDistribution: false,
        note: "テスト",
        updatedAt: NOW,
      })
      .run();

    const events = await getDividendEvents(db, "KO");
    expect(events).toEqual([
      { symbol: "KO", exDate: "2025-06-13", amount: 0.51, currency: "USD" },
      { symbol: "KO", exDate: "2025-12-12", amount: 0.51, currency: "USD" },
    ]);
    expect(await getDividendEvents(db)).toHaveLength(3);

    expect(await getFxRate(db, "USDJPY")).toBe(158);
    expect(await getFxRate(db, "EURJPY")).toBeNull();

    const mappings = await getDividendMappings(db);
    expect(mappings).toEqual([
      {
        holdingName: "iTrustインド株式",
        yahooSymbol: null,
        currency: "JPY",
        annualDistributionPerUnit: 120,
        paysDistribution: false,
        note: "テスト",
        updatedAt: NOW,
      },
    ]);
  });
});
