import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema.js";
import {
  getAllAccountStatuses,
  getAllAccounts,
  getAssetHistory,
  getHoldings,
  getMonthlySummary,
  getLastScrapedAt,
  getTransactions,
  upsertAccount,
  upsertAccountStatus,
  upsertAssetHistory,
  upsertDailySnapshot,
  upsertHoldings,
  upsertTransactions,
} from "../src/repo.js";

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

describe("repo round-trip", () => {
  it("upsertHoldings が assetCategory から asset_categories を登録し categoryId を割当する", () => {
    const db = freshDb();

    upsertAccount(db, { id: "acc-1", name: "SBIベネフィット", institution: "SBI", category: "other" });

    upsertHoldings(db, [
      {
        accountId: "acc-1",
        name: "eMAXIS Slim 米国株式(S&P500)",
        assetCategory: "投資信託",
        quantity: 1,
        value: 110000,
        averagePrice: null,
        unrealizedGain: null,
        scrapedAt: "2026-02-14T06:30:00.000Z",
      },
      {
        accountId: "acc-1",
        name: "普通預金",
        assetCategory: "預金・現金",
        quantity: 0,
        value: 35,
        averagePrice: null,
        unrealizedGain: null,
        scrapedAt: "2026-02-14T06:30:00.000Z",
      },
      // 同じ語彙は同一 asset_categories 行を共有する
      {
        accountId: "acc-1",
        name: "ニッセイ日経平均インデックスファンド",
        assetCategory: "投資信託",
        quantity: 1,
        value: 110000,
        averagePrice: null,
        unrealizedGain: null,
        scrapedAt: "2026-02-14T06:30:00.000Z",
      },
      // assetCategory 無し行は null のまま（本家: 負債等と同様）
      {
        accountId: "acc-1",
        name: "不明銘柄",
        quantity: 0,
        value: 0,
        averagePrice: null,
        unrealizedGain: null,
        scrapedAt: "2026-02-14T06:30:00.000Z",
      },
    ]);

    const cats = db.select().from(schema.assetCategories).all();
    expect(cats.map((c) => c.name).sort()).toEqual(["投資信託", "預金・現金"]);

    const rows = db.select().from(schema.holdings).all();
    const fund = rows.find((h) => h.name.startsWith("eMAXIS"));
    const nikkei = rows.find((h) => h.name.startsWith("ニッセイ"));
    const deposit = rows.find((h) => h.name === "普通預金");
    expect(fund?.categoryId).not.toBeNull();
    expect(fund?.categoryId).toBe(nikkei?.categoryId);
    expect(deposit?.categoryId).not.toBe(fund?.categoryId);
    expect(rows.find((h) => h.name === "不明銘柄")?.categoryId).toBeNull();
  });

  it("upsert → read が素通しで一致する", () => {
    const db = freshDb();

    upsertAccount(db, {
      id: "acc-1",
      name: "SMTB 普通",
      institution: "SMTB",
      category: "bank",
    });
    // upsert で上書きされること
    upsertAccount(db, {
      id: "acc-1",
      name: "SMTB 円普通",
      institution: "SMBC信託",
      category: "bank",
    });
    upsertAccount(db, {
      id: "acc-2",
      name: "SMTB 投信",
      institution: "SMBC信託",
      category: "securities",
    });

    upsertAccountStatus(db, {
      accountId: "acc-1",
      balance: 123456,
      scrapedAt: "2026-02-14T06:30:00.000Z",
    });
    upsertAccountStatus(db, {
      accountId: "acc-1",
      balance: 223456,
      scrapedAt: "2026-02-14T07:00:00.000Z",
    });

    upsertDailySnapshot(db, { accountId: "acc-1", date: "2026-02-14", balance: 100000 });
    upsertDailySnapshot(db, { accountId: "acc-1", date: "2026-02-14", balance: 223456 });

    upsertHoldings(db, [
      {
        accountId: "acc-2",
        name: "eMAXIS Slim 全世界",
        quantity: 12.345,
        value: 123456,
        averagePrice: 9000,
        unrealizedGain: 12345,
        scrapedAt: "2026-02-14T06:30:00.000Z",
      },
    ]);

    upsertTransactions(db, [
      {
        externalId: "tx-1",
        accountId: "acc-1",
        date: "2026-02-10",
        description: "給与",
        amount: 300000,
        category: "収入",
      },
      {
        externalId: null,
        accountId: "acc-1",
        date: "2026-02-11",
        description: "食費",
        amount: -3000,
        category: "食費",
      },
      // 同一 externalId は重複投入されないこと
      {
        externalId: "tx-1",
        accountId: "acc-1",
        date: "2026-02-10",
        description: "給与",
        amount: 300000,
        category: "収入",
      },
    ]);

    upsertAssetHistory(db, [
      { date: "2026-02-13", category: "bank", value: 100000 },
      { date: "2026-02-14", category: "bank", value: 223456 },
      // 同日は上書きされること
      { date: "2026-02-14", category: "bank", value: 223457 },
    ]);

    const accounts = getAllAccounts(db);
    expect(accounts).toHaveLength(2);
    expect(accounts.find((a) => a.id === "acc-1")?.name).toBe("SMTB 円普通");

    // acc-2 は残高未登録なので、acc-1 のみ
    const statuses = getAllAccountStatuses(db);
    expect(statuses).toHaveLength(1);
    expect(statuses.find((s) => s.accountId === "acc-1")?.balance).toBe(223456);

    const holdings = getHoldings(db, "acc-2");
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({ name: "eMAXIS Slim 全世界", value: 123456 });

    const txs = getTransactions(db);
    expect(txs).toHaveLength(2);

    const monthly = getMonthlySummary(db);
    expect(monthly).toHaveLength(1);
    expect(monthly[0]).toEqual({ month: "2026-02", income: 300000, expense: 3000, net: 297000 });

    const history = getAssetHistory(db);
    expect(history.filter((h) => h.date === "2026-02-14")).toEqual([
      { date: "2026-02-14", category: "bank", value: 223457 },
    ]);

    expect(getLastScrapedAt(db)).toBe("2026-02-14T07:00:00.000Z");
  });
});
