import type {
  Account,
  AccountCategory,
  AccountStatus,
  AssetHistoryPoint,
  Holding,
  Transaction,
} from "@asset-scraping/shared";
import { desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  accounts,
  accountStatuses,
  assetHistory,
  dailySnapshots,
  holdings,
  transactions,
} from "./schema.js";

export * from "./schema.js";

const nowIso = () => new Date().toISOString();

/** JST の本日 (YYYY-MM-DD) */
export function todayJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export interface UpsertAccountInput {
  id: string;
  name: string;
  institution: string;
  category: AccountCategory;
}

export function upsertAccount(db: Database, input: UpsertAccountInput): void {
  const ts = nowIso();
  db.insert(accounts)
    .values({ ...input, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({
      target: accounts.id,
      set: {
        name: input.name,
        institution: input.institution,
        category: input.category,
        updatedAt: ts,
      },
    })
    .run();
}

export function upsertAccountStatus(db: Database, input: AccountStatus): void {
  db.insert(accountStatuses)
    .values({
      accountId: input.accountId,
      balance: input.balance,
      scrapedAt: input.scrapedAt,
    })
    .onConflictDoUpdate({
      target: accountStatuses.accountId,
      set: {
        balance: input.balance,
        scrapedAt: input.scrapedAt,
      },
    })
    .run();
}

export function upsertDailySnapshot(
  db: Database,
  input: { accountId: string; date: string; balance: number },
): void {
  db.insert(dailySnapshots)
    .values(input)
    .onConflictDoUpdate({
      target: [dailySnapshots.accountId, dailySnapshots.date],
      set: { balance: input.balance },
    })
    .run();
}

export function upsertHoldings(db: Database, rows: Holding[]): void {
  if (rows.length === 0) return;
  db.transaction((tx) => {
    for (const h of rows) {
      tx.insert(holdings)
        .values({
          accountId: h.accountId,
          name: h.name,
          quantity: h.quantity,
          value: h.value,
          averagePrice: h.averagePrice,
          unrealizedGain: h.unrealizedGain,
          scrapedAt: h.scrapedAt,
        })
        .onConflictDoUpdate({
          target: [holdings.accountId, holdings.name],
          set: {
            quantity: h.quantity,
            value: h.value,
            averagePrice: h.averagePrice,
            unrealizedGain: h.unrealizedGain,
            scrapedAt: h.scrapedAt,
          },
        })
        .run();
    }
  });
}

export function upsertTransactions(db: Database, rows: Transaction[]): void {
  if (rows.length === 0) return;
  const ts = nowIso();
  db.transaction((tx) => {
    for (const t of rows) {
      tx.insert(transactions)
        .values({
          externalId: t.externalId,
          accountId: t.accountId,
          date: t.date,
          description: t.description,
          amount: t.amount,
          category: t.category,
          createdAt: ts,
        })
        .onConflictDoNothing()
        .run();
    }
  });
}

export function upsertAssetHistory(db: Database, rows: AssetHistoryPoint[]): void {
  if (rows.length === 0) return;
  db.transaction((tx) => {
    for (const p of rows) {
      tx.insert(assetHistory)
        .values(p)
        .onConflictDoUpdate({
          target: [assetHistory.date, assetHistory.category],
          set: { value: p.value },
        })
        .run();
    }
  });
}

// ---------------------------------------------------------------------------
// Read API (web / mcp)
// ---------------------------------------------------------------------------

export function getAllAccounts(db: Database): Account[] {
  const rows = db
    .select({
      id: accounts.id,
      name: accounts.name,
      institution: accounts.institution,
      category: accounts.category,
    })
    .from(accounts)
    .orderBy(accounts.category, accounts.name)
    .all();
  return rows.map((r) => ({ ...r, category: r.category as AccountCategory }));
}

export function getAllAccountStatuses(db: Database): AccountStatus[] {
  const rows = db
    .select({
      accountId: accountStatuses.accountId,
      balance: accountStatuses.balance,
      scrapedAt: accountStatuses.scrapedAt,
    })
    .from(accountStatuses)
    .all();
  return rows;
}

export function getHoldings(db: Database, accountId?: string): Holding[] {
  const base = db
    .select({
      accountId: holdings.accountId,
      name: holdings.name,
      quantity: holdings.quantity,
      value: holdings.value,
      averagePrice: holdings.averagePrice,
      unrealizedGain: holdings.unrealizedGain,
      scrapedAt: holdings.scrapedAt,
    })
    .from(holdings);
  const rows = accountId
    ? base.where(eq(holdings.accountId, accountId)).all()
    : base.all();
  return rows;
}

export function getTransactions(
  db: Database,
  opts: { limit?: number; since?: string } = {},
): Transaction[] {
  const base = db
    .select({
      externalId: transactions.externalId,
      accountId: transactions.accountId,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      category: transactions.category,
    })
    .from(transactions)
    .orderBy(desc(transactions.date), desc(transactions.id));
  const rows = (opts.since ? base.where(gte(transactions.date, opts.since)) : base)
    .limit(opts.limit ?? 500)
    .all();
  return rows;
}

export function getAssetHistory(
  db: Database,
  opts: { since?: string } = {},
): AssetHistoryPoint[] {
  const base = db
    .select({
      date: assetHistory.date,
      category: assetHistory.category,
      value: assetHistory.value,
    })
    .from(assetHistory)
    .orderBy(assetHistory.date);
  const rows = (opts.since ? base.where(gte(assetHistory.date, opts.since)) : base).all();
  return rows.map((r) => ({ ...r, category: r.category as AccountCategory }));
}

/** 月次収支サマリー (YYYY-MM 単位、収入-支出) */
export interface MonthlySummary {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export function getMonthlySummary(
  db: Database,
  opts: { months?: number } = {},
): MonthlySummary[] {
  const months = opts.months ?? 12;
  const rows = db
    .select({
      month: sql<string>`strftime('%Y-%m', ${transactions.date})`.as("month"),
      income: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
      expense: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
    .orderBy(sql`strftime('%Y-%m', ${transactions.date}) desc`)
    .limit(months)
    .all();
  return rows.map((r) => ({
    month: r.month,
    income: Number(r.income),
    expense: Number(r.expense),
    net: Number(r.income) - Number(r.expense),
  }));
}

/** 直近スクレイプ日時（account_statuses.scraped_at の最大値） */
export function getLastScrapedAt(db: Database): string | null {
  const row = db
    .select({ scrapedAt: accountStatuses.scrapedAt })
    .from(accountStatuses)
    .where(isNotNull(accountStatuses.scrapedAt))
    .orderBy(desc(accountStatuses.scrapedAt))
    .limit(1)
    .get();
  return row?.scrapedAt ?? null;
}

/** 口座名解決用（id -> name） */
export function getAccountNameMap(db: Database): Map<string, string> {
  const rows = db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .all();
  return new Map(rows.map((r) => [r.id, r.name]));
}
