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
  pruneHoldingsByName,
  dedupeLegacyTransactions,
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

describe("upsertTransactions の重複排除", () => {
  const base = {
    accountId: "acc-1",
    date: "2026-02-11",
    description: "食費",
    amount: -3000,
    category: "食費",
  };

  it("externalId が null の取引も内容ベース ID を合成し、再 upsert で重複しない", () => {
    const db = freshDb();
    upsertAccount(db, { id: "acc-1", name: "SMTB", institution: "SMTB", category: "bank" });

    const rows = [
      { externalId: null, ...base },
      { externalId: null, ...base, description: "コーヒー", amount: -450 },
    ];
    upsertTransactions(db, rows);
    // 再スクレイプ相当（同一内容を再度投入）
    upsertTransactions(db, rows);

    const all = db.select().from(schema.transactions).all();
    expect(all).toHaveLength(2);
    expect(all.every((t) => t.externalId !== null && t.mfId !== null)).toBe(true);
  });

  it("同日・同額・同摘要の正当な重複は出現回数で区別して保持する", () => {
    const db = freshDb();
    upsertAccount(db, { id: "acc-1", name: "SMTB", institution: "SMTB", category: "bank" });

    const rows = [
      { externalId: null, ...base, description: "コーヒー", amount: -450 },
      { externalId: null, ...base, description: "コーヒー", amount: -450 },
    ];
    upsertTransactions(db, rows);
    expect(db.select().from(schema.transactions).all()).toHaveLength(2);

    // 再スクレイプしても 2 件のまま（それぞれ occurrence 0/1 に upsert される）
    upsertTransactions(db, rows);
    const all = db.select().from(schema.transactions).all();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((t) => t.externalId)).size).toBe(2);
  });
});

describe("pruneHoldingsByName（スクレイプ時の stale cleanup）", () => {
  const mk = (accountId: string, name: string, value: number) => ({
    accountId,
    name,
    quantity: 0,
    value,
    averagePrice: null,
    unrealizedGain: null,
    scrapedAt: "2026-02-14T06:30:00.000Z",
  });

  it("同一口座で今回の name 集合に無い旧世代行だけを削除し、他口座は残す", () => {
    const db = freshDb();
    upsertAccount(db, { id: "acc-1", name: "イオン銀行", institution: "イオン銀行", category: "bank" });
    upsertAccount(db, { id: "acc-2", name: "他行", institution: "他行", category: "bank" });
    upsertHoldings(db, [
      mk("acc-1", "アメシスト支店 普通預金", 35),
      mk("acc-1", "アメシスト支店", 35),
      mk("acc-2", "円預金", 100),
    ]);

    const removed = pruneHoldingsByName(db, "acc-1", ["アメシスト支店 普通預金"]);
    expect(removed).toBe(1);
    expect(getHoldings(db, "acc-1").map((h) => h.name)).toEqual(["アメシスト支店 普通預金"]);
    expect(getHoldings(db, "acc-2")).toHaveLength(1);
  });

  it("空集合では何も削除しない（パース 0 件で全消しする事故を防ぐ）", () => {
    const db = freshDb();
    upsertAccount(db, { id: "acc-1", name: "銀行", institution: "銀行", category: "bank" });
    upsertHoldings(db, [mk("acc-1", "普通預金", 100)]);
    expect(pruneHoldingsByName(db, "acc-1", [])).toBe(0);
    expect(getHoldings(db, "acc-1")).toHaveLength(1);
  });
});

describe("dedupeLegacyTransactions（F3: 旧 externalId=null 行の突合）", () => {
  function insertLegacy(
    db: DB,
    t: { accountId: string; date: string; description: string; amount: number; type?: string | null },
  ): void {
    db.insert(schema.transactions)
      .values({
        externalId: null,
        mfId: null,
        accountId: t.accountId,
        date: t.date,
        description: t.description,
        amount: t.amount,
        category: null,
        type: t.type ?? null,
        isTransfer: false,
        isExcludedFromCalculation: false,
        createdAt: "2026-10-01T00:00:00.000Z",
      })
      .run();
  }

  it("決定的 externalId 行が同一内容にある旧 null 行は削除し、決定的行は残す", () => {
    const db = freshDb();
    upsertAccount(db, { id: "acc-1", name: "イオン銀行", institution: "イオン銀行", category: "bank" });
    // 新世代の決定的行 1 件（parse → upsert）
    upsertTransactions(db, [
      { externalId: null, accountId: "acc-1", date: "2026-10-04", description: "VISA", amount: -90, category: null },
    ]);
    // 旧世代の null 11 件
    for (let i = 0; i < 11; i++) {
      insertLegacy(db, { accountId: "acc-1", date: "2026-10-04", description: "VISA", amount: -90 });
    }
    expect(db.select().from(schema.transactions).all()).toHaveLength(12);

    expect(dedupeLegacyTransactions(db)).toEqual({ deleted: 11, reassigned: 0 });
    const all = db.select().from(schema.transactions).all();
    expect(all).toHaveLength(1);
    expect(all[0]!.externalId).not.toBeNull();
    expect(getMonthlySummary(db)[0]).toMatchObject({ income: 0, expense: 90, net: -90 });
  });

  it("同日同額同摘要の正当な複数回取引（occurrence 0/1）は消さない", () => {
    const db = freshDb();
    upsertAccount(db, { id: "acc-1", name: "イオン銀行", institution: "イオン銀行", category: "bank" });
    upsertTransactions(db, [
      { externalId: null, accountId: "acc-1", date: "2026-10-01", description: "コーヒー", amount: -450, category: null },
      { externalId: null, accountId: "acc-1", date: "2026-10-01", description: "コーヒー", amount: -450, category: null },
    ]);
    for (let i = 0; i < 3; i++) {
      insertLegacy(db, { accountId: "acc-1", date: "2026-10-01", description: "コーヒー", amount: -450 });
    }

    expect(dedupeLegacyTransactions(db)).toEqual({ deleted: 3, reassigned: 0 });
    const all = db.select().from(schema.transactions).all();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((t) => t.externalId)).size).toBe(2);
  });

  it("決定的行が無い旧 null 行は消さず externalId を付与し、次回 upsert が同一行に収束する", () => {
    const db = freshDb();
    upsertAccount(db, { id: "acc-1", name: "イオン銀行", institution: "イオン銀行", category: "bank" });
    insertLegacy(db, { accountId: "acc-1", date: "2026-10-02", description: "国税", amount: -2 });
    insertLegacy(db, { accountId: "acc-1", date: "2026-10-02", description: "国税", amount: -2 });

    // 決定的行が無い内容は削除しない（新方式で拾えない取引を消す恐れがあるため）
    expect(dedupeLegacyTransactions(db)).toEqual({ deleted: 0, reassigned: 2 });
    expect(db.select().from(schema.transactions).all()).toHaveLength(2);

    // 再スクレイプ相当: 1 件だけ戻っても occurrence 0 に upsert され増殖しない
    upsertTransactions(db, [
      { externalId: null, accountId: "acc-1", date: "2026-10-02", description: "国税", amount: -2, category: null },
    ]);
    const all = db.select().from(schema.transactions).all();
    expect(all).toHaveLength(2);
    expect(all.every((t) => t.externalId !== null)).toBe(true);
  });
});
