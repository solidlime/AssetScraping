/**
 * repo.ts upsertHoldingValues の roundtrip テスト。
 * 本家 holding_values（holdingId×snapshotId, 評価額/数量/単価/平均取得単価/前日比/含み損益）を
 * crawler 由来 Holding rows から冪等 upsert できることを担保する。
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../src/schema.ts";
import { closeTestDb, createTestDb, resetTestDb } from "../src/test-helpers.ts";
import {
  todayJst,
  upsertAccount,
  upsertDailySnapshot,
  upsertHoldingValues,
  upsertHoldings,
  type Database,
} from "../src/repo.ts";

const dbs: Database[] = [];

function freshDb(): Database {
  const db = createTestDb();
  dbs.push(db);
  return db;
}

afterAll(() => {
  for (const db of dbs) closeTestDb(db);
});

function seedAccountWithSnapshot(db: Database, date: string, balance: number): void {
  upsertAccount(db, { id: "acc-1", name: "SMTB 投信", institution: "SMBC信託", category: "securities" });
  upsertDailySnapshot(db, { accountId: "acc-1", date, balance });
}

const HOLDING = {
  accountId: "acc-1",
  name: "eMAXIS Slim 全世界",
  quantity: 12.345,
  value: 123456,
  averagePrice: 9000,
  unrealizedGain: null,
  scrapedAt: "2026-02-14T06:30:00.000Z",
};

describe("upsertHoldingValues roundtrip", () => {
  it("holdings + snapshot から holding_values を生成する", () => {
    const db = freshDb();
    resetTestDb(db);
    const date = "2026-02-14";
    seedAccountWithSnapshot(db, date, 123456);
    upsertHoldings(db, [HOLDING]);

    const written = upsertHoldingValues(db, [HOLDING], date);
    expect(written).toEqual({ written: 1, skipped: 0 });

    const rows = db.select().from(schema.holdingValues).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      holdingId: 1,
      snapshotId: 1,
      amount: 123456,
      quantity: 12.345,
      unitPrice: HOLDING.value / HOLDING.quantity,
      avgCostPrice: 9000,
      // HOLDING は crawler 取得の含み損益が null のため、平均取得単価からのフォールバックで算出される。
      // 取得価額の母数は「評価額 − 含み損益」。単価×数量は使わない（投信・外貨建てで桁が壊れる）
      unrealizedGain: 12351,
      unrealizedGainPct: (12351 / (123456 - 12351)) * 100,
    });
    // 初回実行は前日データが無いため dailyChange は null
    expect(rows[0]!.dailyChange).toBeNull();
  });

  it("同 holding×snapshot の再実行は上書きで冪等", () => {
    const db = freshDb();
    resetTestDb(db);
    const date = "2026-02-14";
    seedAccountWithSnapshot(db, date, 123456);
    upsertHoldings(db, [HOLDING]);

    upsertHoldingValues(db, [HOLDING], date);
    upsertHoldingValues(db, [HOLDING], date);

    const rows = db.select().from(schema.holdingValues).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(123456);
  });

  it("翌日 snapshot では前日 holding_values との差分を dailyChange に入れる", () => {
    const db = freshDb();
    resetTestDb(db);
    upsertAccount(db, { id: "acc-1", name: "SMTB 投信", institution: "SMBC信託", category: "securities" });

    const day1 = { ...HOLDING, value: 120000 };
    const day2 = { ...HOLDING, value: 123456 };

    upsertDailySnapshot(db, { accountId: "acc-1", date: "2026-02-13", balance: 120000 });
    upsertHoldings(db, [day1]);
    upsertHoldingValues(db, [day1], "2026-02-13");

    upsertDailySnapshot(db, { accountId: "acc-1", date: "2026-02-14", balance: 123456 });
    upsertHoldings(db, [day2]);
    upsertHoldingValues(db, [day2], "2026-02-14");

    const rows = db.select().from(schema.holdingValues).all().sort((a, b) => a.id - b.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.dailyChange).toBeNull();
    expect(rows[1]!.dailyChange).toBe(123456 - 120000);
  });

  it("avgCostPrice から unrealizedGainPct を計算する", () => {
    const db = freshDb();
    resetTestDb(db);
    const date = todayJst();
    seedAccountWithSnapshot(db, date, 123456);
    upsertHoldings(db, [HOLDING]);

    upsertHoldingValues(db, [HOLDING], date);

    const row = db.select().from(schema.holdingValues).where(eq(schema.holdingValues.id, 1)).get();
    const unitPrice = HOLDING.value / HOLDING.quantity;
    expect(row!.unrealizedGainPct).toBeCloseTo(((unitPrice - 9000) / 9000) * 100, 6);
  });

  it("crawler が取得した unrealizedGain をそのまま保存し、単価×数量で再計算しない", () => {
    const db = freshDb();
    resetTestDb(db);
    const date = todayJst();
    seedAccountWithSnapshot(db, date, 123456);
    upsertHoldings(db, [{ ...HOLDING, unrealizedGain: 12345 }]);

    upsertHoldingValues(db, [{ ...HOLDING, unrealizedGain: 12345 }], date);

    const row = db.select().from(schema.holdingValues).where(eq(schema.holdingValues.id, 1)).get();
    expect(row!.unrealizedGain).toBe(12345);
    expect(row!.unrealizedGainPct).toBeCloseTo((12345 / (123456 - 12345)) * 100, 6);
  });

  it("投信の平均取得単価が1万口あたりでも桁が壊れない（実データ回帰）", () => {
    const db = freshDb();
    resetTestDb(db);
    const date = todayJst();
    seedAccountWithSnapshot(db, date, 315991);
    // 実測 NAS データ: eMAXIS Slim 全世界株式（オール・カントリー）
    // 評価額 315,991 / 数量 81,789 / 平均取得単価 27,021（1万口あたり）/ 含み損益 94,989
    const fund = {
      accountId: "acc-1",
      name: "eMAXIS Slim 全世界株式(オール・カントリー)",
      quantity: 81789,
      value: 315991,
      averagePrice: 27021,
      unrealizedGain: 94989,
      scrapedAt: "2026-10-10T12:20:57.102Z",
    };
    upsertHoldings(db, [fund]);
    upsertHoldingValues(db, [fund], date);

    const row = db.select().from(schema.holdingValues).where(eq(schema.holdingValues.id, 1)).get();
    expect(row!.unrealizedGain).toBe(94989);
    expect(row!.unrealizedGainPct).toBeCloseTo((94989 / (315991 - 94989)) * 100, 6);
    // 素朴な単価×数量だと 22億円になる
    expect(Math.round(27021 * 81789)).toBeGreaterThan(2_000_000_000);
  });

  it("米国株の平均取得単価が現地通貨建てでも桁が壊れない（実データ回帰）", () => {
    const db = freshDb();
    resetTestDb(db);
    const date = todayJst();
    seedAccountWithSnapshot(db, date, 10233005);
    // 実測 NAS データ: アドバンスト マイクロ デバイシズ
    // 評価額 10,233,005 / 数量 100 / 平均取得単価 19.65（USD）/ 含み損益 9,921,671
    const us = {
      accountId: "acc-1",
      name: "アドバンスト マイクロ デバイシズ",
      quantity: 100,
      value: 10233005,
      averagePrice: 19.65,
      unrealizedGain: 9921671,
      scrapedAt: "2026-10-10T12:20:57.102Z",
    };
    upsertHoldings(db, [us]);
    upsertHoldingValues(db, [us], date);

    const row = db.select().from(schema.holdingValues).where(eq(schema.holdingValues.id, 1)).get();
    expect(row!.unrealizedGain).toBe(9921671);
    expect(row!.unrealizedGainPct).toBeCloseTo((9921671 / (10233005 - 9921671)) * 100, 6);
    // 現地通貨建て単価をそのまま使うと +520663% に暴走する（回帰防止）
    const naivePct = ((10233005 / 100 - 19.65) / 19.65) * 100;
    expect(naivePct).toBeGreaterThan(500_000);
    expect(row!.unrealizedGainPct!).toBeLessThan(10_000);
  });

  it("snapshot が無い口座の行は skip する", () => {
    const db = freshDb();
    resetTestDb(db);
    upsertAccount(db, { id: "acc-1", name: "SMTB 投信", institution: "SMBC信託", category: "securities" });
    upsertHoldings(db, [HOLDING]);

    expect(upsertHoldingValues(db, [HOLDING], "2026-02-14")).toEqual({ written: 0, skipped: 1 });
    expect(db.select().from(schema.holdingValues).all()).toHaveLength(0);
  });
});
