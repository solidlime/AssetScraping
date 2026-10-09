/**
 * 本家 mf-dashboard 互換 queries / repositories + repo.ts 派生列のトランジェント統合テスト。
 * better-sqlite3 in-memory DB に本家流のシード（group → account → snapshot →
 * holding_values / transactions / asset_history）を流し込み、
 * 移植 queries が現行 schema（text id + 本家互換追加列）で正しく動くことを担保する。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema.ts";
import { getJstYearMonthKey } from "@asset-scraping/date-utils";
import { upsertGroup, linkAccountToGroup, getCurrentGroupId } from "../src/repositories/groups.ts";
import {
  upsertAccount,
  saveAccountStatuses,
  buildAccountIdMap,
  ensureUnknownAccountId,
} from "../src/repositories/accounts.ts";
import { getOrCreateInstitutionCategory } from "../src/repositories/institution-categories.ts";
import { getOrCreateCategory } from "../src/repositories/categories.ts";
import { createSnapshot } from "../src/repositories/snapshots.ts";
import { createHolding, saveHoldingValue } from "../src/repositories/holdings.ts";
import { replaceTransactionsForMonth } from "../src/repositories/transactions.ts";
import {
  getAccountsWithAssets,
  getAccountsGroupedByCategory,
} from "../src/queries/account.ts";
import { getHoldingsWithLatestValues } from "../src/queries/holding.ts";
import { getTransactions, getTransactionsByAccountId } from "../src/queries/transaction.ts";
import { getMonthlySummaries } from "../src/queries/summary.ts";
import {
  getAssetHistory,
  getAssetHistoryWithCategories,
  getAssetBreakdownByCategory,
  getLatestTotalAssets,
  getDailyAssetChange,
} from "../src/queries/asset.ts";
import { upsertAssetHistory } from "../src/repo.ts";

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
    // SAFETY: drizzle の BetterSQLite3Database は内部インスタンスを $client に保持する（型定義には無い）
    const sqlite = (db as unknown as { $client: BetterSqlite3.Database }).$client;
    sqlite.close();
  }
});

const NOW = "2026-02-14T06:30:00.000Z";

describe("本家互換 queries/repositories 結線", () => {
  it("group → account → snapshot → holding_values → queries が素通しで一致する", async () => {
    const db = freshDb();

    upsertGroup(db, { id: "0", name: "グループ選択なし", isCurrent: true });
    expect(getCurrentGroupId(db)).toBe("0");

    const accountId = upsertAccount(db, {
      mfId: "acc-1",
      name: "SMTB 投信",
      type: "自動連携",
      status: "ok",
      lastUpdated: "02/14 06:21",
      url: "",
      totalAssets: 1234567,
    });
    saveAccountStatuses(db, [
      { accountId, status: { mfId: "acc-1", name: "SMTB 投信", type: "自動連携", status: "ok", lastUpdated: "02/14 06:21", url: "", totalAssets: 1234567 } },
    ]);
    linkAccountToGroup(db, "0", accountId);

    const categoryId = getOrCreateCategory(db, "投資信託");
    expect(getOrCreateCategory(db, "投資信託")).toBe(categoryId);
    getOrCreateInstitutionCategory(db, "投資信託");

    const now = "2026-02-14";
    const snapshotId = createSnapshot(db, "0", now, null, { accountId, balance: 1234567 });
    const holdingId = createHolding(db, accountId, "eMAXIS Slim 全世界", "asset", {
      categoryId,
      quantity: 12.345,
      value: 123456,
      scrapedAt: NOW,
    });
    saveHoldingValue(db, holdingId, snapshotId, {
      amount: 123456,
      quantity: 12.345,
      avgCostPrice: 9000,
      unrealizedGain: 12345,
    });

    // 未解決口座フォールバック
    expect(ensureUnknownAccountId(db)).toBe("unknown");

    // queries: Holding
    const holdings = await getHoldingsWithLatestValues(undefined, db);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      name: "eMAXIS Slim 全世界",
      amount: 123456,
      quantity: 12.345,
      avgCostPrice: 9000,
      accountName: "SMTB 投信",
    });

    // queries: Account
    const accountsWithAssets = await getAccountsWithAssets(undefined, db);
    expect(accountsWithAssets).toHaveLength(1);
    expect(accountsWithAssets[0]).toMatchObject({ mfId: "acc-1", totalAssets: 1234567 });
    expect((await getAccountsGroupedByCategory(undefined, db))[0]?.accounts).toHaveLength(1);
  });

  it("transactions repository + summary/transaction queries が収支計算を一致させる", async () => {
    const db = freshDb();
    upsertGroup(db, { id: "0", name: "グループ選択なし", isCurrent: true });
    const accountId = upsertAccount(db, {
      mfId: "acc-1",
      name: "SMTB",
      type: "自動連携",
      status: "ok",
      lastUpdated: "",
      url: "",
      totalAssets: 0,
    });
    linkAccountToGroup(db, "0", accountId);

    const month = getJstYearMonthKey();
    const accountIdMap = buildAccountIdMap(db);
    const d = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
    const count = replaceTransactionsForMonth(
      db,
      month,
      [
        {
          mfId: "tx-1",
          date: d(10),
          category: "収入",
          subCategory: "給与",
          description: "2月の給与",
          amount: 300000,
          type: "income",
          isTransfer: false,
          isExcludedFromCalculation: false,
          accountName: "SMTB",
        },
        {
          mfId: "tx-2",
          date: d(11),
          category: "食費",
          subCategory: "自炊",
          description: " grocery",
          amount: 3000,
          type: "expense",
          isTransfer: false,
          isExcludedFromCalculation: false,
          accountName: "SMTB",
        },
        // 内部振替（グループ内→グループ内）は収支から除外される
        {
          mfId: "tx-3",
          date: d(12),
          category: null,
          subCategory: null,
          description: "振替",
          amount: 50000,
          type: "transfer",
          isTransfer: true,
          isExcludedFromCalculation: true,
          accountName: "SMTB",
          transferTarget: "SMTB",
        },
      ],
      accountIdMap,
    );
    expect(count).toBe(3);

    const summary = (await getMonthlySummaries({}, db)).find((s) => s.month === month);
    expect(summary).toBeDefined();
    expect(summary).toMatchObject({ totalIncome: 300000, totalExpense: 3000, netIncome: 297000 });

    const txs = await getTransactions({}, db);
    const tx1 = txs.find((t) => t.mfId === "tx-1");
    expect(tx1).toMatchObject({ amount: 300000, type: "income" });

    const byAccount = await getTransactionsByAccountId(accountId, undefined, db);
    expect(byAccount).toHaveLength(3);
  });

  it("asset_history は repo.ts upsert → 本家準拠 queries (アダプタ) で一致する", async () => {
    const db = freshDb();
    upsertAssetHistory(db, [
      { date: "2026-02-12", category: "bank", value: 100000 },
      { date: "2026-02-13", category: "bank", value: 223456 },
      { date: "2026-02-13", category: "securities", value: 1000 },
      // 同日は上書きされること
      { date: "2026-02-13", category: "bank", value: 223457 },
      { date: "2026-02-14", category: "bank", value: 223457 },
      { date: "2026-02-14", category: "securities", value: 400000 },
    ]);

    // 派生列（totalAssets/change）が入っていること
    const lastRows = db.select().from(schema.assetHistory).all();
    const feb14 = lastRows.filter((r) => r.date === "2026-02-14");
    expect(feb14[0]!.totalAssets).toBe(623457);
    expect(feb14[0]!.change).toBe(623457 - 224457);

    const latest = await getLatestTotalAssets(undefined, db);
    expect(latest).toBe(623457);

    const history = await getAssetHistory({}, db);
    // 本家準拠: date 降順。先頭が最新日
    expect(history[0]).toEqual({ date: "2026-02-14", totalAssets: 623457, change: 399000 });

    const withCategories = await getAssetHistoryWithCategories({}, db);
    expect(withCategories).toHaveLength(3);
    expect(withCategories[0]).toEqual({
      date: "2026-02-14",
      totalAssets: 623457,
      categories: { bank: 223457, securities: 400000 },
    });

    const breakdown = await getAssetBreakdownByCategory(undefined, db);
    expect(breakdown).toEqual([
      { category: "securities", amount: 400000 },
      { category: "bank", amount: 223457 },
    ]);

    const dailyChange = await getDailyAssetChange(undefined, db);
    expect(dailyChange).toEqual({
      today: 623457,
      yesterday: 224457,
      change: 399000,
    });
  });
});
