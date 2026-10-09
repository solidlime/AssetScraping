/**
 * holding queries（口座別 snapshot 前提）のトランジェント統合テスト。
 *
 * 現行 daily_snapshots は「1日1口座1行」（口座別）であり、本家のように
 * 「全アカウント共通で1行」ではない。最新 snapshot 1 行で holdingValues を
 * 絞ると、口座によって snapshot が違うため保有資産が欠落する
 * （監査指摘②）。各 holding の最新 holding_values を駆動することを担保する。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema.js";
import { upsertGroup, linkAccountToGroup } from "../src/repositories/groups.js";
import { upsertAccount } from "../src/repositories/accounts.js";
import { createSnapshot } from "../src/repositories/snapshots.js";
import { createHolding, saveHoldingValue } from "../src/repositories/holdings.js";
import { getOrCreateCategory } from "../src/repositories/categories.js";
import {
  getHoldingsWithLatestValues,
  hasInvestmentHoldings,
} from "../src/queries/holding.js";
import { getAssetBreakdownByCategory } from "../src/queries/asset.js";

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

const NOW = "2026-10-10T06:30:00.000Z";

describe("holding queries（口座別 snapshot）", () => {
  it("snapshot が口座別に分散しても全 holding の最新値を返す", async () => {
    const db = freshDb();

    upsertGroup(db, { id: "0", name: "グループ選択なし", isCurrent: true });
    const fundCategoryId = getOrCreateCategory(db, "投資信託");
    const depositCategoryId = getOrCreateCategory(db, "預金・現金");

    const acc1 = upsertAccount(db, {
      mfId: "acc-fund",
      name: "SBIベネフィット",
      type: "自動連携",
      status: "ok",
      lastUpdated: "10/10 06:21",
      url: "",
      totalAssets: 110000,
    });
    const acc2 = upsertAccount(db, {
      mfId: "acc-bank",
      name: "SMTB",
      type: "自動連携",
      status: "ok",
      lastUpdated: "10/10 06:21",
      url: "",
      totalAssets: 35,
    });
    linkAccountToGroup(db, "0", acc1);
    linkAccountToGroup(db, "0", acc2);

    const snap1 = createSnapshot(db, "0", "2026-10-09", null, { accountId: acc1, balance: 100000 });
    const snap2 = createSnapshot(db, "0", "2026-10-10", null, { accountId: acc1, balance: 110000 });
    const snap3 = createSnapshot(db, "0", "2026-10-10", null, { accountId: acc2, balance: 35 });

    const fundId = createHolding(db, acc1, "eMAXIS Slim 米国株式", "asset", {
      categoryId: fundCategoryId,
      quantity: 1,
      value: 110000,
      scrapedAt: NOW,
    });
    const depositId = createHolding(db, acc2, "普通預金", "asset", {
      categoryId: depositCategoryId,
      quantity: 0,
      value: 35,
      scrapedAt: NOW,
    });

    // fund は 2 snapshot に履歴を持つ（最新は snap2 的 110000）
    saveHoldingValue(db, fundId, snap1, { amount: 100000 });
    saveHoldingValue(db, fundId, snap2, { amount: 110000 });
    // 普通預金は別口座の snapshot（snap3）のみ
    saveHoldingValue(db, depositId, snap3, { amount: 35 });

    const holdings = await getHoldingsWithLatestValues(undefined, db);
    expect(holdings).toHaveLength(2);

    const fund = holdings.find((h) => h.name === "eMAXIS Slim 米国株式");
    const deposit = holdings.find((h) => h.name === "普通預金");
    // 各 holding は自口座の最新 snapshot 値（fund は示される最新 snap2 値）
    expect(fund).toMatchObject({ amount: 110000, categoryName: "投資信託" });
    expect(deposit).toMatchObject({ amount: 35, categoryName: "預金・現金" });

    expect(await hasInvestmentHoldings(undefined, db)).toBe(true);

    // /bs バランスシートのカテゴリ内訳（監査指摘③）:
    // 本家 getAssetBreakdownByCategory は holdings の assetCategory（本家語彙）駆動。
    // 英語コード（bank/securities…）を返す現行実装では web 側の語彙・色マップで崩壖していた。
    const breakdown = await getAssetBreakdownByCategory(undefined, db);
    expect(breakdown).toEqual([
      { category: "投資信託", amount: 110000 },
      { category: "預金・現金", amount: 35 },
    ]);
  });
});
