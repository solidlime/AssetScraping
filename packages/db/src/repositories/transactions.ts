import { and, eq, gte, inArray, like, lt, sql } from "drizzle-orm";
import type { Db, DbExecutor } from "../index.ts";
import { schema } from "../index.ts";
import type { CashFlowItem } from "../types.ts";
import { convertToIsoDate, now, upsertById } from "../utils.ts";
import { ensureUnknownAccountId } from "./accounts.ts";

const BATCH_SIZE = 500;

export interface TransactionDateRange {
  from: string;
  to: string;
}

export interface TransactionPeriodReplacement {
  dateRange?: TransactionDateRange;
  isComplete?: boolean;
  items: CashFlowItem[];
  month: string;
}

export function saveTransaction(
  db: DbExecutor,
  item: CashFlowItem,
  accountIdMap?: Map<string, string>,
): void {
  if (!item.mfId || item.mfId.startsWith("unknown")) {
    return;
  }

  const fallbackAccountId = ensureUnknownAccountId(db);
  const data = prepareTransactionData(item, accountIdMap, fallbackAccountId);

  upsertById(db, schema.transactions, eq(schema.transactions.mfId, item.mfId), data, data);
}

/**
 * 指定月にトランザクションが存在するかチェック
 * @param month "2026-01" 形式
 */
export function hasTransactionsForMonth(db: Db, month: string): boolean {
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.transactions)
    .where(like(schema.transactions.date, `${month}%`))
    .get();
  return (result?.count ?? 0) > 0;
}

export function hasCashFlowPeriod(db: Db, month: string): boolean {
  const result = db
    .select({ id: schema.cashFlowPeriods.id })
    .from(schema.cashFlowPeriods)
    .where(eq(schema.cashFlowPeriods.month, month))
    .get();
  return result !== undefined;
}

export function findExistingTransactionMfIds(db: Db, mfIds: string[]): Set<string> {
  if (mfIds.length === 0) return new Set();

  const existingMfIds = new Set<string>();
  for (let i = 0; i < mfIds.length; i += BATCH_SIZE) {
    const batch = mfIds.slice(i, i + BATCH_SIZE);
    const rows = db
      .select({ mfId: schema.transactions.mfId })
      .from(schema.transactions)
      .where(inArray(schema.transactions.mfId, batch))
      .all();

    for (const row of rows) {
      if (row.mfId !== null) existingMfIds.add(row.mfId);
    }
  }

  return existingMfIds;
}

/**
 * 指定月のトランザクションを削除
 * @param month "2026-01" 形式
 */
export function deleteTransactionsForMonth(db: DbExecutor, month: string): number {
  const result = db
    .delete(schema.transactions)
    .where(like(schema.transactions.date, `${month}%`))
    .run();
  return result.changes;
}

function deleteTransactionsForDateRange(
  db: DbExecutor,
  range: TransactionDateRange & { toExclusive: string },
): number {
  const result = db
    .delete(schema.transactions)
    .where(
      and(
        gte(schema.transactions.date, range.from),
        lt(schema.transactions.date, range.toExclusive),
      ),
    )
    .run();
  return result.changes;
}

function resolveTransactionDateRange(
  month: string,
  range?: TransactionDateRange,
): TransactionDateRange {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Invalid transaction month");
  }

  if (range) {
    const isValidDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!isValidDate(range.from) || !isValidDate(range.to) || range.from > range.to) {
      throw new Error("Invalid transaction date range");
    }
    return range;
  }

  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export function assertNonOverlappingTransactionRanges(
  months: TransactionPeriodReplacement[],
): void {
  const ranges = months
    .map(({ dateRange, month }) => resolveTransactionDateRange(month, dateRange))
    .sort((left, right) => left.from.localeCompare(right.from));

  let latestEnd = "";
  for (const range of ranges) {
    if (range.from <= latestEnd) {
      throw new Error("Overlapping transaction date ranges");
    }
    latestEnd = range.to;
  }
}

function getExclusiveRangeEnd(to: string): string {
  const nextDay = new Date(`${to}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay.toISOString().slice(0, 10);
}

/**
 * accountName から account_id をルックアップ
 */
function lookupAccountId(
  accountIdMap: Map<string, string> | undefined,
  name: string | undefined,
): string | null {
  if (!accountIdMap || !name) return null;

  // 完全一致を試行
  const exactMatch = accountIdMap.get(name);
  if (exactMatch) return exactMatch;

  // 部分一致で探す
  for (const [key, id] of accountIdMap) {
    if (key.startsWith(name)) {
      return id;
    }
  }
  return null;
}

/**
 * CashFlowItem を DB レコード形式に変換
 */
function prepareTransactionData(
  item: CashFlowItem,
  accountIdMap: Map<string, string> | undefined,
  fallbackAccountId: string,
  currentYear?: number,
): {
  mfId: string;
  date: string;
  accountId: string;
  category: string | null;
  subCategory: string | null;
  description: string;
  amount: number;
  type: string;
  isTransfer: boolean;
  isExcludedFromCalculation: boolean;
  transferTarget: string | null;
  transferTargetAccountId: string | null;
} {
  const isoDate = convertToIsoDate(item.date, currentYear);
  const accountId = lookupAccountId(accountIdMap, item.accountName);
  const transferTargetAccountId = lookupAccountId(accountIdMap, item.transferTarget);

  return {
    mfId: item.mfId,
    date: isoDate,
    accountId: accountId ?? fallbackAccountId ?? null,
    category: item.category,
    subCategory: item.subCategory ?? null,
    description: item.description,
    amount: item.amount,
    type: item.type,
    isTransfer: item.isTransfer,
    isExcludedFromCalculation: item.isExcludedFromCalculation ?? false,
    transferTarget: item.transferTarget ?? null,
    transferTargetAccountId,
  };
}

/**
 * 指定月のトランザクションを保存（既存データは削除して上書き）
 */
export function replaceTransactionsForMonth(
  db: DbExecutor,
  month: string,
  items: CashFlowItem[],
  accountIdMap?: Map<string, string>,
  dateRange?: TransactionDateRange,
  isComplete = items.length > 0,
): number {
  if (items.some((item) => !item.mfId || item.mfId.startsWith("unknown"))) {
    throw new Error("Invalid transactions: missing transaction ID");
  }
  if (!isComplete) {
    throw new Error("Cannot replace an incomplete cash flow period");
  }
  const currentYear = parseInt(month.slice(0, 4), 10);
  const replacementRange = resolveTransactionDateRange(month, dateRange);
  const toExclusive = getExclusiveRangeEnd(replacementRange.to);
  const fallbackAccountId = ensureUnknownAccountId(db);
  const records = items.map((item) =>
    prepareTransactionData(item, accountIdMap, fallbackAccountId, currentYear),
  );

  if (records.some(({ date }) => date < replacementRange.from || date >= toExclusive)) {
    throw new Error("Invalid transactions: item falls outside replacement date range");
  }

  // Validate the complete replacement before deleting existing data.
  const deleted = deleteTransactionsForDateRange(db, { ...replacementRange, toExclusive });
  if (deleted > 0) {
    console.log(
      `  Deleted ${deleted} existing transactions for ${replacementRange.from} to ${replacementRange.to}`,
    );
  }

  const timestamp = now();

  // バルクinsert（BATCH_SIZE単位）
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const recordsWithTimestamps = batch.map((data) => {
      return {
        ...data,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });

    db
      .insert(schema.transactions)
      .values(recordsWithTimestamps)
      .onConflictDoUpdate({
        target: schema.transactions.mfId,
        set: {
          date: sql`excluded.date`,
          accountId: sql`excluded.account_id`,
          category: sql`excluded.category`,
          subCategory: sql`excluded.sub_category`,
          description: sql`excluded.description`,
          amount: sql`excluded.amount`,
          type: sql`excluded.type`,
          isTransfer: sql`excluded.is_transfer`,
          isExcludedFromCalculation: sql`excluded.is_excluded_from_calculation`,
          transferTarget: sql`excluded.transfer_target`,
          transferTargetAccountId: sql`excluded.transfer_target_account_id`,
          updatedAt: timestamp,
        },
      })
      .run();
  }

  db
    .insert(schema.cashFlowPeriods)
    .values({
      month,
      periodStart: replacementRange.from,
      periodEnd: replacementRange.to,
      transactionCount: records.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: schema.cashFlowPeriods.month,
      set: {
        periodStart: replacementRange.from,
        periodEnd: replacementRange.to,
        transactionCount: records.length,
        updatedAt: timestamp,
      },
    })
    .run();

  return items.length;
}

export function saveTransactionsForMonths(
  db: Db,
  months: TransactionPeriodReplacement[],
  accountIdMap?: Map<string, string>,
): number[] {
  assertNonOverlappingTransactionRanges(months);

  return db.transaction((transaction) => {
    const savedCounts: number[] = [];
    for (const { dateRange, isComplete, items, month } of months) {
      savedCounts.push(
        replaceTransactionsForMonth(
          transaction,
          month,
          items,
          accountIdMap,
          dateRange,
          isComplete,
        ),
      );
    }
    return savedCounts;
  });
}

export function saveTransactionsForMonth(
  db: Db,
  month: string,
  items: CashFlowItem[],
  accountIdMap?: Map<string, string>,
  dateRange?: TransactionDateRange,
  isComplete?: boolean,
): number {
  const [savedCount = 0] = saveTransactionsForMonths(
    db,
    [{ dateRange, isComplete, items, month }],
    accountIdMap,
  );
  return savedCount;
}
