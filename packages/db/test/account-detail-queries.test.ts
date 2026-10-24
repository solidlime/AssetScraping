/**
 * 口座詳細ページが使う「口座で絞る」クエリの境界テスト。
 *
 * ページは getHoldingsByAccountId / getTransactionsByAccountId で
 * 「その口座に属するデータだけ」を取る。他口座の holdings / transactions が
 * 混ざらないこと、グループ外の口座では空になることを担保する。
 */
import BetterSqlite3 from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema.js";
import { upsertGroup, linkAccountToGroup } from "../src/repositories/groups.js";
import { upsertAccount, buildAccountIdMap } from "../src/repositories/accounts.js";
import { createSnapshot } from "../src/repositories/snapshots.js";
import { createHolding, saveHoldingValue } from "../src/repositories/holdings.js";
import { saveTransaction } from "../src/repositories/transactions.js";
import { getOrCreateCategory } from "../src/repositories/categories.js";
import { getHoldingsByAccountId } from "../src/queries/holding.js";
import { getAccountByMfId } from "../src/queries/account.js";
import { getTransactionsByAccountId } from "../src/queries/transaction.js";

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

describe("口座で絞るクエリ", () => {
  it("holding / transaction は指定口座の行だけを返し他口座を混ぜない", async () => {
    const db = freshDb();
    upsertGroup(db, { id: "0", name: "グループ選択なし", isCurrent: true });

    const accA = upsertAccount(db, {
      mfId: "acc-securities",
      name: "SBI証券",
      type: "自動連携",
      status: "ok",
      lastUpdated: NOW,
      url: "",
      totalAssets: 45240730,
    });
    const accB = upsertAccount(db, {
      mfId: "acc-bank",
      name: "イオン銀行",
      type: "自動連携",
      status: "ok",
      lastUpdated: NOW,
      url: "",
      totalAssets: 35,
    });
    linkAccountToGroup(db, "0", accA);
    linkAccountToGroup(db, "0", accB);

    const fundCategoryId = getOrCreateCategory(db, "投資信託");

    const snapA = createSnapshot(db, "0", "2026-10-10", null, { accountId: accA, balance: 100000 });
    const snapB = createSnapshot(db, "0", "2026-10-10", null, { accountId: accB, balance: 35 });

    const holdingA = createHolding(db, accA, "eMAXIS Slim 米国株式", "asset", {
      categoryId: fundCategoryId,
      quantity: 10,
      value: 100000,
      scrapedAt: NOW,
    });
    const holdingB = createHolding(db, accB, "普通預金", "asset", {
      quantity: 0,
      value: 35,
      scrapedAt: NOW,
    });
    saveHoldingValue(db, holdingA, snapA, { amount: 100000, quantity: 10 });
    saveHoldingValue(db, holdingB, snapB, { amount: 35 });

    const accountIdMap = buildAccountIdMap(db);
    saveTransaction(
      db,
      {
        mfId: "tx-a",
        date: "2026-10-01",
        category: "収入",
        subCategory: null,
        description: "配当",
        amount: 1000,
        type: "income",
        isTransfer: false,
        isExcludedFromCalculation: false,
        accountName: "SBI証券",
      },
      accountIdMap,
    );
    saveTransaction(
      db,
      {
        mfId: "tx-b",
        date: "2026-10-02",
        category: "食費",
        subCategory: null,
        description: "スーパー",
        amount: -2000,
        type: "expense",
        isTransfer: false,
        isExcludedFromCalculation: false,
        accountName: "イオン銀行",
      },
      accountIdMap,
    );

    const holdingsA = await getHoldingsByAccountId(accA, undefined, db);
    expect(holdingsA.map((h) => h.name)).toEqual(["eMAXIS Slim 米国株式"]);
    expect(holdingsA.every((h) => h.accountName === "SBI証券")).toBe(true);

    const holdingsB = await getHoldingsByAccountId(accB, undefined, db);
    expect(holdingsB.map((h) => h.name)).toEqual(["普通預金"]);

    const txA = await getTransactionsByAccountId(accA, undefined, db);
    expect(txA.map((t) => t.mfId)).toEqual(["tx-a"]);
    expect(txA.every((t) => t.accountId === accA)).toBe(true);

    const txB = await getTransactionsByAccountId(accB, undefined, db);
    expect(txB.map((t) => t.mfId)).toEqual(["tx-b"]);
  });

  it("グループ外の口座 ID では空配列を返す", async () => {
    const db = freshDb();
    upsertGroup(db, { id: "0", name: "グループ選択なし", isCurrent: true });
    const acc = upsertAccount(db, {
      mfId: "acc-orphan",
      name: "未所属",
      type: "自動連携",
      status: "ok",
      lastUpdated: NOW,
      url: "",
      totalAssets: 0,
    });
    // グループにリンクしない
    expect(await getHoldingsByAccountId(acc, undefined, db)).toEqual([]);
    expect(await getTransactionsByAccountId(acc, undefined, db)).toEqual([]);
  });

  it("getAccountByMfId は引き落とし予定額・予定日・card 判定用の列を返す", async () => {
    const db = freshDb();
    upsertGroup(db, { id: "0", name: "グループ選択なし", isCurrent: true });
    const acc = upsertAccount(db, {
      mfId: "acc-card",
      name: "楽天カード",
      type: "自動連携",
      status: "ok",
      lastUpdated: NOW,
      url: "",
      totalAssets: 0,
    });
    linkAccountToGroup(db, "0", acc);
    db.update(schema.accounts).set({ category: "card" }).where(eq(schema.accounts.id, acc)).run();
    db.insert(schema.accountStatuses)
      .values({
        accountId: acc,
        balance: 0,
        scrapedAt: NOW,
        status: "ok",
        lastUpdated: NOW,
        totalAssets: 0,
        scheduledWithdrawalAmount: 89655,
        scheduledWithdrawalDate: "2026-10-27",
        scheduledWithdrawalConfirmed: true,
      })
      .run();

    const account = await getAccountByMfId("acc-card", undefined, db);
    expect(account).toMatchObject({
      category: "card",
      institution: "楽天カード",
      scheduledWithdrawalAmount: 89655,
      scheduledWithdrawalDate: "2026-10-27",
      scheduledWithdrawalConfirmed: true,
      withdrawalAccountId: null,
    });
  });

  it("getTransactionsByAccountId は DB の金額をそのまま返し subCategory も返す", async () => {
    const db = freshDb();
    upsertGroup(db, { id: "0", name: "グループ選択なし", isCurrent: true });
    const acc = upsertAccount(db, {
      mfId: "acc-cash",
      name: "楽天カード",
      type: "自動連携",
      status: "ok",
      lastUpdated: NOW,
      url: "",
      totalAssets: 0,
    });
    linkAccountToGroup(db, "0", acc);

    const accountIdMap = buildAccountIdMap(db);
    // 保存は正値 + type（crawler と同じ形）
    saveTransaction(
      db,
      {
        mfId: "tx-expense",
        date: "2026-10-05",
        category: "食費",
        subCategory: "コンビニ",
        description: "セブンイレブン",
        amount: 2000,
        type: "expense",
        isTransfer: false,
        isExcludedFromCalculation: false,
        accountName: "楽天カード",
      },
      accountIdMap,
    );
    saveTransaction(
      db,
      {
        mfId: "tx-income",
        date: "2026-10-06",
        category: "収入",
        subCategory: null,
        description: "給与",
        amount: 300000,
        type: "income",
        isTransfer: false,
        isExcludedFromCalculation: false,
        accountName: "楽天カード",
      },
      accountIdMap,
    );

    const rows = await getTransactionsByAccountId(acc, undefined, db);
    // 符号は DB の値そのまま（一覧の getMfTransactions と同じ）。反転は AmountDisplay/type で扱う
    expect(rows.find((t) => t.mfId === "tx-expense")).toMatchObject({
      amount: 2000,
      type: "expense",
      subCategory: "コンビニ",
    });
    expect(rows.find((t) => t.mfId === "tx-income")).toMatchObject({
      amount: 300000,
      subCategory: null,
    });
  });
});
