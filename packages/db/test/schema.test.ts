/**
 * 本家 mf-dashboard 互換 schema（追加テーブル・追加カラム）の整合性テスト。
 * マイグレーション 0000+0001 を適用した in-memory DB で、
 * 本家準拠テーブル間の FK と基本操作が通ることを担保する。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema.ts";
import {
  assetHistory,
  assetHistoryCategories,
  assetCategories,
  cashFlowPeriods,
  dailySnapshots,
  groupAccounts,
  groups,
  holdingValues,
  holdings,
  institutionCategories,
  accounts,
  transactions,
} from "../src/schema.ts";

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

const ts = "2026-02-14T06:30:00.000Z";

describe("本家互換 schema 整合性", () => {
  it("groups / group_accounts / accounts の多対多と cascade が通る", () => {
    const db = freshDb();

    db.insert(groups)
      .values({ id: "0", name: "グループ選択なし", isCurrent: true, createdAt: ts, updatedAt: ts })
      .run();
    const acc = db
      .insert(accounts)
      .values({ id: "acc-1", mfId: "acc-1", name: "SMTB", institution: "SMTB", category: "bank", createdAt: ts, updatedAt: ts })
      .returning({ id: accounts.id })
      .get();
    db.insert(groupAccounts)
      .values({ groupId: "0", accountId: acc.id, createdAt: ts, updatedAt: ts })
      .run();

    const linked = db
      .select({ accountId: groupAccounts.accountId })
      .from(groupAccounts)
      .where(eq(groupAccounts.groupId, "0"))
      .all();
    expect(linked).toEqual([{ accountId: "acc-1" }]);

    // group 削除で cascade（group_accounts 側）
    db.delete(groups).where(eq(groups.id, "0")).run();
    expect(db.select().from(groupAccounts).all()).toHaveLength(0);
  });

  it("holdings + holding_values + daily_snapshots が snapshot 駆動で保存できる", () => {
    const db = freshDb();
    const acc = db
      .insert(accounts)
      .values({ id: "acc-1", name: "SMTB", institution: "SMTB", category: "bank", createdAt: ts, updatedAt: ts })
      .returning({ id: accounts.id })
      .get();
    const cat = db
      .insert(assetCategories)
      .values({ name: "投資信託", createdAt: ts, updatedAt: ts })
      .returning({ id: assetCategories.id })
      .get();
    const snap = db
      .insert(dailySnapshots)
      .values({ accountId: acc.id, date: "2026-02-14", balance: 100000, createdAt: ts, updatedAt: ts })
      .returning({ id: dailySnapshots.id })
      .get();
    const h = db
      .insert(holdings)
      .values({
        accountId: acc.id,
        categoryId: cat.id,
        name: "eMAXIS Slim 全世界",
        type: "asset",
        createdAt: ts,
        updatedAt: ts,
        quantity: 12.345,
        value: 123456,
        scrapedAt: ts,
      })
      .returning({ id: holdings.id })
      .get();
    db.insert(holdingValues)
      .values({
        holdingId: h.id,
        snapshotId: snap.id,
        amount: 123456,
        quantity: 12.345,
        avgCostPrice: 9000,
        unrealizedGain: 12345,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    const rows = db
      .select({ amount: holdingValues.amount, name: holdings.name })
      .from(holdingValues)
      .innerJoin(holdings, eq(holdings.id, holdingValues.holdingId))
      .all();
    expect(rows).toEqual([{ amount: 123456, name: "eMAXIS Slim 全世界" }]);
  });

  it("asset_history + asset_history_categories と cash_flow_periods が保存できる", () => {
    const db = freshDb();
    const row = db
      .insert(assetHistory)
      .values({
        date: "2026-02-14",
        category: "bank",
        value: 223456,
        totalAssets: 400000,
        change: 1000,
        updatedAt: ts,
      })
      .returning({ id: assetHistory.id })
      .get();
    db.insert(assetHistoryCategories)
      .values({ assetHistoryId: row.id, categoryName: "預金・現金", amount: 223456, createdAt: ts, updatedAt: ts })
      .onConflictDoNothing()
      .run();
    db.insert(cashFlowPeriods)
      .values({ month: "2026-02", periodStart: "2026-02-01", periodEnd: "2026-02-28", transactionCount: 3, createdAt: ts, updatedAt: ts })
      .run();

    expect(db.select().from(assetHistoryCategories).all()).toHaveLength(1);
    expect(db.select().from(cashFlowPeriods).all()).toHaveLength(1);

    // asset_history 削除で categories cascade
    db.delete(assetHistory).where(eq(assetHistory.id, row.id)).run();
    expect(db.select().from(assetHistoryCategories).all()).toHaveLength(0);
  });

  it("transactions に本家互換列（type / isTransfer / transferTargetAccountId）が入る", () => {
    const db = freshDb();
    const acc = db
      .insert(accounts)
      .values({ id: "acc-1", name: "SMTB", institution: "SMTB", category: "bank", createdAt: ts, updatedAt: ts })
      .returning({ id: accounts.id })
      .get();
    db.insert(transactions)
      .values({
        mfId: "tx-1",
        externalId: "tx-1",
        accountId: acc.id,
        date: "2026-02-10",
        description: "給与",
        amount: 300000,
        category: "収入",
        type: "income",
        isTransfer: false,
        isExcludedFromCalculation: false,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    const row = db.select().from(transactions).where(eq(transactions.mfId, "tx-1")).get();
    expect(row).toMatchObject({ type: "income", isTransfer: false });
  });

  it("institution_categories の unique と account_statuses 拡張列が通る", () => {
    const db = freshDb();
    const cat = db
      .insert(institutionCategories)
      .values({ name: "銀行", createdAt: ts, updatedAt: ts })
      .returning({ id: institutionCategories.id })
      .get();
    db.insert(accounts)
      .values({ id: "acc-1", name: "SMTB", institution: "SMTB", category: "bank", categoryId: cat.id, createdAt: ts, updatedAt: ts })
      .run();
    db.insert(institutionCategories)
      .values({ name: "銀行", createdAt: ts, updatedAt: ts })
      .onConflictDoNothing()
      .run();
    expect(db.select().from(institutionCategories).all()).toHaveLength(1);

    db.insert(schema.accountStatuses)
      .values({ accountId: "acc-1", balance: 1000, scrapedAt: ts, status: "ok", lastUpdated: ts, totalAssets: 1000, createdAt: ts, updatedAt: ts })
      .run();
    expect(db.select().from(schema.accountStatuses).all()).toHaveLength(1);
  });
});
