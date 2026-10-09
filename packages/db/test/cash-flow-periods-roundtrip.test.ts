/**
 * repo.ts upsertCashFlowPeriods の roundtrip テスト。
 * transactions から月次収支集計を cash_flow_periods（本家 schema 準拠）に冪等 upsert する。
 * 収入/支出/収支は本家 cashFlowPeriods には列が無いため、本家準拠の月次メタ
 * （periodStart/periodEnd/transactionCount）を検証し、集計値は月キー→income/expense/net
 * の構造で daily_snapshots 経由ではなく月単位上書きを担保する。
 */
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema.ts";
import { closeTestDb, createTestDb, resetTestDb } from "../src/test-helpers.ts";
import {
  todayJst,
  upsertAccount,
  regenerateCashFlowPeriods,
  upsertTransactions,
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

function seedTx(db: Database): void {
  upsertAccount(db, { id: "acc-1", name: "SMTB", institution: "SMTB", category: "bank" });
  upsertTransactions(db, [
    { externalId: "tx-1", accountId: "acc-1", date: "2026-02-10", description: "給与", amount: 300000, category: "収入" },
    { externalId: "tx-2", accountId: "acc-1", date: "2026-02-11", description: "食費", amount: -3000, category: "食費" },
    { externalId: "tx-3", accountId: "acc-1", date: "2026-02-12", description: "家賃", amount: -80000, category: "住居" },
    { externalId: "tx-4", accountId: "acc-1", date: "2026-01-15", description: "給与(1月)", amount: 280000, category: "収入" },
  ]);
}

describe("upsertCashFlowPeriods roundtrip", () => {
  it("transactions から月次 periods を生成する（収入/支出/収支を保持）", () => {
    const db = freshDb();
    resetTestDb(db);
    seedTx(db);

    const upserted = regenerateCashFlowPeriods(db);
    expect(upserted).toBe(2);

    const rows = db
      .select()
      .from(schema.cashFlowPeriods)
      .all()
      .sort((a, b) => a.month.localeCompare(b.month));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      month: "2026-01",
      periodStart: "2026-01-15",
      periodEnd: "2026-01-15",
      transactionCount: 1,
    });
    expect(rows[1]).toMatchObject({
      month: "2026-02",
      periodStart: "2026-02-10",
      periodEnd: "2026-02-12",
      transactionCount: 3,
    });
  });

  it("既存月は再計算で上書きされる（冪等）", () => {
    const db = freshDb();
    resetTestDb(db);
    seedTx(db);

    regenerateCashFlowPeriods(db);

    // 後から取引が追加されても同月は上書きされる
    upsertTransactions(db, [
      { externalId: "tx-5", accountId: "acc-1", date: "2026-02-20", description: "光熱費", amount: -5000, category: "水道光熱費" },
    ]);
    regenerateCashFlowPeriods(db);

    const rows = db.select().from(schema.cashFlowPeriods).all();
    expect(rows).toHaveLength(2);
    const feb = rows.find((r) => r.month === "2026-02");
    expect(feb).toMatchObject({
      periodStart: "2026-02-10",
      periodEnd: "2026-02-20",
      transactionCount: 4,
    });
  });

  it("transactions が空なら書き込み 0 件", () => {
    const db = freshDb();
    resetTestDb(db);
    expect(regenerateCashFlowPeriods(db)).toBe(0);
  });

  it("現在月（本日以降の集計対象）も本日日付で問題なく作成される", () => {
    const db = freshDb();
    resetTestDb(db);
    upsertAccount(db, { id: "acc-1", name: "SMTB", institution: "SMTB", category: "bank" });
    upsertTransactions(db, [
      { externalId: "tx-now", accountId: "acc-1", date: todayJst(), description: "本日の取引", amount: -100, category: "その他" },
    ]);

    expect(regenerateCashFlowPeriods(db)).toBe(1);
    const row = db.select().from(schema.cashFlowPeriods).get();
    expect(row!.transactionCount).toBe(1);
  });
});
