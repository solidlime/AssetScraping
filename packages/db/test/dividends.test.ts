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
    expect(forecast.months[12]!.amountJpy).toBe(76_314); // KO 3月 24,174 + JEPQ 3月 52,140
    expect(forecast.months[12]!.confirmed).toBe(false);

    // 当月: 実イベント = JEPQ 0.5 × 550 × 158 = 43,450。
    // 推定は KO のみだが、当月（2月）は KO の支払い月ではないため季節性見込み = 0。
    expect(forecast.currentMonth).toMatchObject({
      month: "2026-02",
      confirmedJpy: 43_450,
      estimatedJpy: 0,
      totalJpy: 43_450,
    });

    // 当年: 2026年実績 85,162 + 残り10ヶ月 × 月次見込み 49,770
    // 当年: 実績 + 当年の残り月（3〜12月）の暦月見込み。
    // 実績 2026-01/02 = 85,162、残り月 = KO 96,696 + JEPQ 488,378 = 585,074
    expect(forecast.thisYearJpy).toBe(670_236);
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

  it("東証の英数字コード（563A）を .T / JPY として解決する", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);

    seedHolding(db, accountId, snapshotId, "株式(現物)", "GXナスDカバコ", {
      quantity: 800,
      value: 863_200,
      code: "563A",
    });
    seedEvent(db, "563A.T", "2026-02-10", 14, "JPY");

    const forecast = await getDividendForecast(db, { now: NOW_DATE });
    const row = forecast.rows.find((r) => r.holdingName === "GXナスDカバコ")!;
    expect(row.resolved).toBe(true);
    expect(row.yahooSymbol).toBe("563A.T");
    expect(row.currency).toBe("JPY");
    expect(row.reason).toBeNull();
  });
});

describe("月別バケットの季節性", () => {
  const JEPQ_NAME = "JPM NDAQ エクイティプレミア インカム ETF";
  const MONTHS_12 = [
    "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08",
    "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
  ];

  it("四半期払い銘柄は支払い月のみ非ゼロになる（KO は 3/6/9/12 月）", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);
    seedHolding(db, accountId, snapshotId, "株式(現物)", "コカ-コーラ", {
      quantity: 300,
      value: 4_079_196,
      code: "KO",
    });
    // 3月は直近3回の平均 (0.48 + 0.51 + 0.53) / 3 = 0.50667
    seedEvent(db, "KO", "2023-03-14", 0.48, "USD");
    seedEvent(db, "KO", "2024-03-14", 0.51, "USD");
    seedEvent(db, "KO", "2025-03-14", 0.53, "USD");
    seedEvent(db, "KO", "2025-06-13", 0.6, "USD");
    seedEvent(db, "KO", "2025-09-12", 0.62, "USD");
    seedEvent(db, "KO", "2025-12-12", 0.64, "USD");

    const forecast = await getDividendForecast(db, { now: NOW_DATE });
    const future = forecast.months.filter((m) => m.month > "2026-02");
    expect(future.map((m) => m.month)).toEqual([
      "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
      "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02",
    ]);
    // 支払い月のみ非ゼロ（qty 300 × fx 158）
    expect(future.map((m) => m.amountJpy)).toEqual([
      24_016, 0, 0, 28_440, 0, 0, 29_388, 0, 0, 30_336, 0, 0,
    ]);
    expect(future.every((m) => m.confirmed === false)).toBe(true);

    // 整合性検算: 今後12ヶ月バケット合計 ≒ next12MonthsJpy（TTM 年間額）
    const bucketSum = future.reduce((sum, m) => sum + m.amountJpy, 0);
    expect(bucketSum).toBe(112_180);
    expect(forecast.next12MonthsJpy).toBe(113_286);
    expect(
      Math.abs(bucketSum - forecast.next12MonthsJpy) / forecast.next12MonthsJpy,
    ).toBeLessThan(0.05);
  });

  it("月次払い銘柄（JEPQ）は将来月が毎月ほぼ均等になる", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);
    seedHolding(db, accountId, snapshotId, "株式(現物)", JEPQ_NAME, {
      quantity: 300,
      value: 5_000_000,
      code: "JEPQ",
    });
    // 毎月 0.5 を 12ヶ月分
    for (const month of MONTHS_12) seedEvent(db, "JEPQ", `${month}-01`, 0.5, "USD");

    const forecast = await getDividendForecast(db, { now: NOW_DATE });
    const future = forecast.months.filter((m) => m.month > "2026-02");
    // 各暦月見込み 0.5 × 300 × 158 = 23,700
    expect(future.map((m) => m.amountJpy)).toEqual(Array(12).fill(23_700));
    expect(future.every((m) => m.amountJpy > 0)).toBe(true);
  });

  it("thisYearJpy は季節性見込みを使っても当月を二重計上しない", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);
    seedHolding(db, accountId, snapshotId, "株式(現物)", JEPQ_NAME, {
      quantity: 300,
      value: 5_000_000,
      code: "JEPQ",
    });
    for (const month of MONTHS_12) seedEvent(db, "JEPQ", `${month}-01`, 0.5, "USD");

    const forecast = await getDividendForecast(db, { now: NOW_DATE });
    // 当年実績 = 2026-01 + 2026-02 = 1.0 × 300 × 158 = 47,400
    // 残り10ヶ月（3〜12月）見込み = 10 × 23,700 = 237,000
    expect(forecast.thisYearJpy).toBe(284_400);
    // 二重計上していれば 308,100 になる
    expect(forecast.thisYearJpy).not.toBe(308_100);
    // 当月は実績のみで estimated に加算しない
    expect(forecast.currentMonth).toMatchObject({
      confirmedJpy: 23_700,
      estimatedJpy: 0,
      totalJpy: 23_700,
    });
  });
});

describe("当月見込みの季節性（バグB）", () => {
  const NOW_OCT = new Date("2026-10-15T06:30:00.000Z");

  it("四半期払い銘柄は当月（10月）に加算されない", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);
    seedHolding(db, accountId, snapshotId, "株式(現物)", "コカ-コーラ", {
      quantity: 300,
      value: 4_079_196,
      code: "KO",
    });
    // KO は 3/6/9/12 月のみ配当（10月は入金なし）
    for (const exDate of [
      "2025-12-12",
      "2026-03-13",
      "2026-06-12",
      "2026-09-11",
    ]) {
      seedEvent(db, "KO", exDate, 0.6, "USD");
    }

    const forecast = await getDividendForecast(db, { now: NOW_OCT });
    const current = forecast.currentMonth;
    expect(current.month).toBe("2026-10");
    expect(current.confirmedJpy).toBe(0);
    // 旧実装は月割り平均 0.2 × 300 × 158 = 9,480 を加算していた
    expect(current.estimatedJpy).toBe(0);
    expect(current.totalJpy).toBe(0);
  });

  it("毎月払い銘柄は当月イベント未取得でも季節性見込みで加算される", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);
    seedHolding(db, accountId, snapshotId, "株式(現物)", "JPM NDAQ エクイティプレミア インカム ETF", {
      quantity: 300,
      value: 5_000_000,
      code: "JEPQ",
    });
    // 同月10月の直近3回 0.4 / 0.5 / 0.6 → 見込み 0.5。2026-10 は未取得
    seedEvent(db, "JEPQ", "2023-10-01", 0.4, "USD");
    seedEvent(db, "JEPQ", "2024-10-01", 0.5, "USD");
    seedEvent(db, "JEPQ", "2025-10-01", 0.6, "USD");

    const forecast = await getDividendForecast(db, { now: NOW_OCT });
    const current = forecast.currentMonth;
    expect(current.confirmedJpy).toBe(0);
    expect(current.estimatedJpy).toBe(23_700); // 0.5 × 300 × 158
    expect(current.totalJpy).toBe(23_700);
  });

  it("当月に確定イベントがある銘柄は二重計上しない", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);
    seedHolding(db, accountId, snapshotId, "株式(現物)", "コカ-コーラ", {
      quantity: 300,
      value: 4_079_196,
      code: "KO",
    });
    // 当月イベントあり
    seedEvent(db, "KO", "2026-10-01", 0.6, "USD");
    seedEvent(db, "KO", "2026-09-11", 0.6, "USD");

    const forecast = await getDividendForecast(db, { now: NOW_OCT });
    const current = forecast.currentMonth;
    expect(current.confirmedJpy).toBe(28_440); // 0.6 × 300 × 158
    expect(current.estimatedJpy).toBe(0);
    expect(current.totalJpy).toBe(28_440);
  });

  it("手動設定（annualDistributionPerUnit）は当月も月次均等で加算される", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedHolding(db, accountId, snapshotId, "投資信託", "iTrustインド株式", {
      quantity: 97_680,
      value: 212_571,
      code: null,
    });
    db.insert(schema.dividendSymbols)
      .values({ holdingName: "iTrustインド株式", annualDistributionPerUnit: 120 })
      .run();

    const forecast = await getDividendForecast(db, { now: NOW_OCT });
    // round(120/10000×97680) = 1172 / 12 = 97.67 → 98
    expect(forecast.currentMonth.confirmedJpy).toBe(0);
    expect(forecast.currentMonth.estimatedJpy).toBe(98);
    expect(forecast.currentMonth.totalJpy).toBe(98);
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

describe("入金日（payout）ベースの月別バケット", () => {
  // window: 2026-01〜2027-12（ex-date 2026-03 が過去かつシフト先も window 内）
  const NOW_DEC = new Date("2026-12-15T06:30:00.000Z");

  it(".T 銘柄の ex-date は +3ヶ月シフトして入金月に入る", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedHolding(db, accountId, snapshotId, "株式(現物)", "日本電信電話", {
      quantity: 10,
      value: 1_500_000,
      code: "9432",
    });
    seedEvent(db, "9432.T", "2026-03-01", 100, "JPY");

    const forecast = await getDividendForecast(db, { now: NOW_DEC });

    const exDate = forecast.months.find((m) => m.month === "2026-03")!;
    expect(exDate.amountJpy).toBe(1000); // 100 × 10 × 1
    expect(exDate.byHolding).toEqual([
      { holdingName: "日本電信電話", amountJpy: 1000, confirmed: true },
    ]);

    // 配当落ち 2026-03 → 入金 2026-06
    const payout = forecast.payoutMonths.find((m) => m.month === "2026-06")!;
    expect(payout.amountJpy).toBe(1000);
    expect(payout.byHolding).toEqual([
      { holdingName: "日本電信電話", amountJpy: 1000, confirmed: true },
    ]);
    // 配当落ち月そのものには入らない
    expect(forecast.payoutMonths.find((m) => m.month === "2026-03")!.amountJpy).toBe(0);
    // window の長さ・月範囲は months と同一
    expect(forecast.payoutMonths.map((m) => m.month)).toEqual(forecast.months.map((m) => m.month));
  });

  it("米国銘柄の ex-date は +1ヶ月シフトする（KO）", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);
    seedHolding(db, accountId, snapshotId, "株式(現物)", "コカ-コーラ", {
      quantity: 300,
      value: 4_079_196,
      code: "KO",
    });
    seedEvent(db, "KO", "2026-03-13", 0.51, "USD");

    const forecast = await getDividendForecast(db, { now: NOW_DEC });

    expect(forecast.months.find((m) => m.month === "2026-03")!.amountJpy).toBe(24_174);
    // 配当落ち 2026-03 → 入金 2026-04
    expect(forecast.payoutMonths.find((m) => m.month === "2026-04")!.amountJpy).toBe(24_174);
    expect(forecast.payoutMonths.find((m) => m.month === "2026-03")!.amountJpy).toBe(0);
  });

  it("window 内に収まるシフトでは payoutMonths と months の合計が一致する", async () => {
    const db = freshDb();
    const { accountId, snapshotId } = seedBase(db);
    seedFx(db, "USDJPY", 158);
    seedHolding(db, accountId, snapshotId, "株式(現物)", "コカ-コーラ", {
      quantity: 300,
      value: 4_079_196,
      code: "KO",
    });
    // 4月のみ配当の銘柄。ex-date 2025-04（過去）と 2026-04（見込み）は
    // どちらも +1ヶ月シフトで window（2025-03〜2027-02）内に収まる。
    seedEvent(db, "KO", "2025-04-15", 0.51, "USD");

    const forecast = await getDividendForecast(db, { now: NOW_DATE });

    const sum = (buckets: typeof forecast.months) =>
      buckets.reduce((total, m) => total + m.amountJpy, 0);
    expect(sum(forecast.months)).toBe(48_348); // 24,174（実績）+ 24,174（見込み）
    expect(sum(forecast.payoutMonths)).toBe(sum(forecast.months));
    expect(forecast.payoutMonths).toHaveLength(24);

    // 内訳は金額降順・0円を含めない
    const april = forecast.months.find((m) => m.month === "2025-04")!;
    expect(april.byHolding).toEqual([
      { holdingName: "コカ-コーラ", amountJpy: 24_174, confirmed: true },
    ]);
    const may = forecast.payoutMonths.find((m) => m.month === "2025-05")!;
    expect(may.byHolding).toEqual([
      { holdingName: "コカ-コーラ", amountJpy: 24_174, confirmed: true },
    ]);
  });
});
