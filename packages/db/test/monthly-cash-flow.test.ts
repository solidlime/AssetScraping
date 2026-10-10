/**
 * cash_flow_monthly（/cf/monthly の月×行）取込と参照のテスト。
 *
 * 期待値は `.refs/SPEC-cf-monthly.md` の実測表（2026/05〜10）と m05907 の確定規則に従う:
 * - 合計は `〜合計` 行のみから取る（`収入` 行を足すと収入が 2 倍）
 * - 当月(2026-10)は transactions 優先、過去月は cash_flow_monthly
 * - analytics の月平均支出 = (526,600+598,709+977,544+244,691+473,209)/5 = 564,150.6 → 564,151
 */
import { fileURLToPath } from "node:url";
import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "../src/index.js";
import { upsertMonthlyCashFlow } from "../src/repo.js";
import { upsertGroup, linkAccountToGroup } from "../src/repositories/groups.js";
import { upsertAccount, buildAccountIdMap } from "../src/repositories/accounts.js";
import { replaceTransactionsForMonth } from "../src/repositories/transactions.js";
import { getMonthlySummaries } from "../src/queries/summary.js";
import { getFinancialMetrics } from "../src/queries/analytics.js";
import { getJstYearMonthKey } from "@asset-scraping/date-utils";

/** SPEC 表: 月 → [収入合計, 支出合計] */
const SPEC: Record<string, [number, number]> = {
  "2026-05": [636_232, 526_600],
  "2026-06": [665_306, 598_709],
  "2026-07": [1_371_546, 977_544],
  "2026-08": [388_051, 244_691],
  "2026-09": [584_477, 473_209],
  "2026-10": [16, 1_713],
};

const dbs: Database[] = [];
function freshDb(): Database {
  const db = createDb({ path: ":memory:" });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  dbs.push(db);
  return db;
}
afterAll(() => {
  for (const db of dbs) {
    // SAFETY: drizzle の BetterSQLite3Database は内部クライアントを $client に保持する
    (db as unknown as { $client: { close(): void } }).$client.close();
  }
});

/** SPEC 表を cash_flow_monthly の行（合計 + 収入 + 支出 + カテゴリ）に変換して upsert する */
function seedMonthly(db: Database, months = Object.keys(SPEC)): void {
  upsertMonthlyCashFlow(
    db,
    months.map((month) => {
      const [income, expense] = SPEC[month]!;
      return {
        month,
        rows: [
          { name: "収入合計", kind: "income", amount: income },
          { name: "収入", kind: "income", amount: income },
          { name: "支出合計", kind: "expense", amount: expense },
          { name: "食費", kind: "expense", amount: Math.min(expense, 30_000) },
          { name: "住宅", kind: "expense", amount: 100_000 },
          { name: "収支合計", kind: "balance", amount: income - expense },
        ],
      };
    }),
  );
}

function seedGroupAccount(db: Database): string {
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
  return accountId;
}

describe("upsertMonthlyCashFlow（冪等 upsert）", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it("2 回投入しても行数が増えない（month, row_name で冪等）", () => {
    seedMonthly(db, ["2026-09"]);
    const count1 = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.cashFlowMonthly)
      .get()!.n;
    seedMonthly(db, ["2026-09"]);
    const count2 = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.cashFlowMonthly)
      .get()!.n;
    expect(count1).toBe(6);
    expect(count2).toBe(count1);
  });

  it("同一キー（month, row_name）は amount が上書きされる", () => {
    seedMonthly(db, ["2026-09"]);
    upsertMonthlyCashFlow(db, [
      { month: "2026-09", rows: [{ name: "支出合計", kind: "expense", amount: 999_999 }] },
    ]);
    const row = db
      .select()
      .from(schema.cashFlowMonthly)
      .where(
        and(
          eq(schema.cashFlowMonthly.rowName, "支出合計"),
          eq(schema.cashFlowMonthly.month, "2026-09"),
        ),
      )
      .get();
    expect(row?.amount).toBe(999_999);
  });
});

describe("getMonthlySummaries（当月 transactions 優先・過去月 cash_flow_monthly 優先）", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it("cash_flow_monthly が無ければ transactions ベースにフォールバックする", async () => {
    const accountId = seedGroupAccount(db);
    const month = getJstYearMonthKey();
    const accountIdMap = buildAccountIdMap(db);
    replaceTransactionsForMonth(
      db,
      month,
      [
        {
          mfId: "tx-1",
          date: `${month}-10`,
          category: "収入",
          subCategory: "給与",
          description: "給与",
          amount: 300_000,
          type: "income",
          isTransfer: false,
          isExcludedFromCalculation: false,
          accountName: "SMTB",
        },
        {
          mfId: "tx-2",
          date: `${month}-11`,
          category: "食費",
          subCategory: null,
          description: "食費",
          amount: 3_000,
          type: "expense",
          isTransfer: false,
          isExcludedFromCalculation: false,
          accountName: "SMTB",
        },
      ],
      accountIdMap,
    );
    const summary = (await getMonthlySummaries({}, db)).find((s) => s.month === month);
    expect(summary).toMatchObject({ totalIncome: 300_000, totalExpense: 3_000, netIncome: 297_000 });
  });

  it("過去月は cash_flow_monthly を返し、当月は transactions を優先する", async () => {
    seedGroupAccount(db);
    seedMonthly(db); // 2026-05〜10 の合計行を含む
    const currentMonth = getJstYearMonthKey(); // 2026-10（実測日 2026-10-10）

    // 当月 transactions: 収入 300,000 / 支出 3,000（cash_flow_monthly の 16 / 1,713 とは別値）
    const accountIdMap = buildAccountIdMap(db);
    replaceTransactionsForMonth(
      db,
      currentMonth,
      [
        {
          mfId: "tx-cur-1",
          date: `${currentMonth}-10`,
          category: "収入",
          subCategory: null,
          description: "給与",
          amount: 300_000,
          type: "income",
          isTransfer: false,
          isExcludedFromCalculation: false,
          accountName: "SMTB",
        },
        {
          mfId: "tx-cur-2",
          date: `${currentMonth}-11`,
          category: "食費",
          subCategory: null,
          description: "食費",
          amount: 3_000,
          type: "expense",
          isTransfer: false,
          isExcludedFromCalculation: false,
          accountName: "SMTB",
        },
      ],
      accountIdMap,
    );

    const summaries = await getMonthlySummaries({}, db);
    const byMonth = new Map(summaries.map((s) => [s.month, s]));

    // 過去月: cash_flow_monthly の合計行がそのまま出る（transactions は無い）
    expect(byMonth.get("2026-09")).toMatchObject({ totalIncome: 584_477, totalExpense: 473_209 });
    expect(byMonth.get("2026-05")).toMatchObject({ totalIncome: 636_232, totalExpense: 526_600 });
    // 6 か月分が cash_flow_monthly から供給される（05〜10）
    for (const m of ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
      expect(byMonth.get(m), m).toMatchObject({
        totalIncome: SPEC[m]![0],
        totalExpense: SPEC[m]![1],
      });
    }
    // 当月: cash_flow_monthly の 16/1,713 ではなく transactions の 300,000/3,000
    expect(byMonth.get(currentMonth)).toMatchObject({
      totalIncome: 300_000,
      totalExpense: 3_000,
    });
  });
});

describe("analytics（cash_flow_monthly ベースの月平均）", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it("monthlyExpenseAvg が過去月の 支出合計 平均 564,151 になる（修正前は 0）", async () => {
    seedGroupAccount(db);
    // 当月を除く 2026-05〜09 のみシード（2026-10 は当月なので平均から除外される意図の確認）
    seedMonthly(db, ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);

    const metrics = await getFinancialMetrics(undefined, db);
    expect(metrics).not.toBeNull();
    expect(metrics!.savings.monthlyExpenseAvg).toBe(564_151);
  });

  it("calculateBalance の月次収支が cash_flow_monthly の合計行から出る（当月を混ぜない）", async () => {
    seedGroupAccount(db);
    seedMonthly(db, ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);

    const metrics = await getFinancialMetrics(undefined, db);
    const trend = metrics!.balance.trend;
    expect(trend.map((t) => t.month)).not.toContain(getJstYearMonthKey());
    expect(trend.find((t) => t.month === "2026-09")).toMatchObject({
      income: 584_477,
      expense: 473_209,
      balance: 111_268,
    });
    // (584477-473209 + ... ) / 5 の月平均（0 でないこと）
    expect(metrics!.balance.monthlyExpense).toBeGreaterThan(0);
  });

  it("カテゴリ別月平均は 合計 行を除いたカテゴリ行から出る", async () => {
    seedGroupAccount(db);
    seedMonthly(db, ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);

    const metrics = await getFinancialMetrics(undefined, db);
    const byCategory = metrics!.spending.byCategory;
    expect(Object.keys(byCategory)).not.toContain("合計");
    expect(Object.keys(byCategory)).not.toContain("収入合計");
    expect(Object.keys(byCategory)).not.toContain("収支合計");
    expect(byCategory["住宅"]).toBe(100_000);
  });
});
