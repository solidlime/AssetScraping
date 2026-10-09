import type {
  Account,
  AccountCategory,
  AccountStatus,
  AssetHistoryPoint,
  Holding,
  Transaction,
} from "@asset-scraping/shared";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { Database } from "./client.ts";
import {
  accounts,
  accountStatuses,
  assetHistory,
  dailySnapshots,
  holdingValues,
  holdings,
  transactions,
} from "./schema.ts";

export * from "./schema.ts";

const nowIso = () => new Date().toISOString();

/** JST の本日 (YYYY-MM-DD) */
export function todayJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * 本家互換 holding_values の upsert（holdingId×snapshotId）。
 * crawler が scrape 後に呼び出し、holdings 現行値から評価額系派生列を算出する。
 * - amount: 評価額（holdings.value を円丸め）
 * - unitPrice / avgCostPrice: quantity>0 のとき value/quantity・平均取得単価
 * - unrealizedGain / unrealizedGainPct: avgCostPrice から（本家準拠）
 * - dailyChange: 前日 holding_values（同 holding の直近別日付 snapshot）との差分。初日は null
 * snapshot（当日分）が無い holding は skip する（戻り値は書き込み件数）。
 */
export interface UpsertHoldingValuesResult {
  written: number;
  skipped: number;
}

export function upsertHoldingValues(
  db: Database,
  rows: Holding[],
  date: string,
): UpsertHoldingValuesResult {
  if (rows.length === 0) return { written: 0, skipped: 0 };
  const ts = nowIso();

  const result = db.transaction((tx): UpsertHoldingValuesResult => {
    // 各 holdingId の「前日の dailyChange 計算元」を先に取得する（書き込みで自己参照しない）
    let written = 0;
    let skipped = 0;

    for (const h of rows) {
      const holding = tx
        .select({ id: holdings.id })
        .from(holdings)
        .where(and(eq(holdings.accountId, h.accountId), eq(holdings.name, h.name)))
        .get();
      const snapshot = tx
        .select({ id: dailySnapshots.id })
        .from(dailySnapshots)
        .where(and(eq(dailySnapshots.accountId, h.accountId), eq(dailySnapshots.date, date)))
        .get();

      if (!holding || !snapshot) {
        skipped++;
        continue;
      }

      // 前日比: 同 holding の別日付 holding_values のうち最も近い過去日付の amount
      const prev = tx
        .select({
          amount: holdingValues.amount,
          date: dailySnapshots.date,
        })
        .from(holdingValues)
        .innerJoin(dailySnapshots, eq(dailySnapshots.id, holdingValues.snapshotId))
        .where(and(eq(holdingValues.holdingId, holding.id), lt(dailySnapshots.date, date)))
        .orderBy(desc(dailySnapshots.date))
        .limit(1)
        .get();

      const amount = Math.round(h.value);
      const dailyChange = prev ? amount - prev.amount : null;

      const unitPrice = h.quantity > 0 ? h.value / h.quantity : null;
      const avgCostPrice = h.averagePrice;
      const unrealizedGain =
        avgCostPrice !== null && unitPrice !== null
          ? Math.round((unitPrice - avgCostPrice) * h.quantity)
          : (h.unrealizedGain ?? null);
      const unrealizedGainPct =
        avgCostPrice !== null && avgCostPrice > 0 && unitPrice !== null
          ? ((unitPrice - avgCostPrice) / avgCostPrice) * 100
          : null;

      tx
        .insert(holdingValues)
        .values({
          holdingId: holding.id,
          snapshotId: snapshot.id,
          amount,
          quantity: h.quantity,
          unitPrice,
          avgCostPrice,
          dailyChange,
          unrealizedGain,
          unrealizedGainPct,
          createdAt: ts,
          updatedAt: ts,
        })
        .onConflictDoUpdate({
          target: [holdingValues.holdingId, holdingValues.snapshotId],
          set: {
            amount,
            quantity: h.quantity,
            unitPrice,
            avgCostPrice,
            dailyChange,
            unrealizedGain,
            unrealizedGainPct,
            updatedAt: ts,
          },
        })
        .run();
      written++;
    }

    return { written, skipped };
  });

  return result;
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
    // 本家互換列 mfId に ssnb 口座 ID（= 現行 PK id）を同時投入する。
    // 本家準拠 queries は accounts.mfId を参照するため。
    .values({ ...input, mfId: input.id, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({
      target: accounts.id,
      set: {
        name: input.name,
        institution: input.institution,
        category: input.category,
        mfId: input.id,
        updatedAt: ts,
      },
    })
    .run();
}

export function upsertAccountStatus(db: Database, input: AccountStatus): void {
  const ts = nowIso();
  // 本家互換の派生列: status="ok" / lastUpdated=scrapedAt / totalAssets=balance。
  // 本家準拠 queries は status/lastUpdated/totalAssets を参照するため。
  db.insert(accountStatuses)
    .values({
      accountId: input.accountId,
      balance: input.balance,
      scrapedAt: input.scrapedAt,
      status: "ok",
      lastUpdated: input.scrapedAt,
      totalAssets: Math.round(input.balance),
      createdAt: ts,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: accountStatuses.accountId,
      set: {
        balance: input.balance,
        scrapedAt: input.scrapedAt,
        status: "ok",
        lastUpdated: input.scrapedAt,
        totalAssets: Math.round(input.balance),
        updatedAt: ts,
      },
    })
    .run();
}

export function upsertDailySnapshot(
  db: Database,
  input: { accountId: string; date: string; balance: number },
): void {
  const ts = nowIso();
  db.insert(dailySnapshots)
    .values({ ...input, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({
      target: [dailySnapshots.accountId, dailySnapshots.date],
      set: { balance: input.balance, updatedAt: ts },
    })
    .run();
}

export function upsertHoldings(db: Database, rows: Holding[]): void {
  if (rows.length === 0) return;
  const ts = nowIso();
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
          createdAt: ts,
          updatedAt: ts,
        })
        .onConflictDoUpdate({
          target: [holdings.accountId, holdings.name],
          set: {
            quantity: h.quantity,
            value: h.value,
            averagePrice: h.averagePrice,
            unrealizedGain: h.unrealizedGain,
            scrapedAt: h.scrapedAt,
            updatedAt: ts,
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
      // 本家準拠: transactions.amount は常に正値、type で収支を区別する。
      // crawler 由来の符号はここで吸収し、読み出し側（getTransactions）で逆符号化する。
      const amount = Math.abs(t.amount);
      const type = t.amount >= 0 ? "income" : "expense";
      tx.insert(transactions)
        .values({
          externalId: t.externalId,
          mfId: t.externalId,
          accountId: t.accountId,
          date: t.date,
          description: t.description,
          amount,
          category: t.category,
          type,
          isTransfer: false,
          isExcludedFromCalculation: false,
          createdAt: ts,
          updatedAt: ts,
        })
        .onConflictDoUpdate({
          target: [transactions.accountId, transactions.externalId],
          set: {
            amount,
            category: t.category,
            type,
            updatedAt: ts,
          },
        })
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
          set: { value: p.value, updatedAt: nowIso() },
        })
        .run();
    }
  });

  // 本家互換の派生列: 同日の totalAssets（カテゴリ合計）と change（前日比）を
  // 各日付行に一括反映する。本家準拠 queries はこの列を参照する。
  const touched = [...new Set(rows.map((r) => r.date))].sort();
  for (const date of touched) {
    const dayRows = db
      .select({ value: assetHistory.value })
      .from(assetHistory)
      .where(eq(assetHistory.date, date))
      .all();
    const totalAssets = Math.round(dayRows.reduce((sum, r) => sum + r.value, 0));

    const prevDayRow = db
      .select({ date: assetHistory.date })
      .from(assetHistory)
      .where(lt(assetHistory.date, date))
      .orderBy(desc(assetHistory.date))
      .limit(1)
      .get();
    const prevTotal = prevDayRow
      ? db
          .select({ value: assetHistory.value })
          .from(assetHistory)
          .where(eq(assetHistory.date, prevDayRow.date))
          .all()
          .reduce((sum, r) => sum + r.value, 0)
      : null;
    const change = prevTotal === null ? null : totalAssets - Math.round(prevTotal);

    db
      .update(assetHistory)
      .set({ totalAssets, change, updatedAt: nowIso() })
      .where(eq(assetHistory.date, date))
      .run();
  }
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
      type: transactions.type,
    })
    .from(transactions)
    .orderBy(desc(transactions.date), desc(transactions.id));
  const rows = (opts.since ? base.where(gte(transactions.date, opts.since)) : base)
    .limit(opts.limit ?? 500)
    .all();
  // upsertTransactions は本家準拠で正値+type 保管するため、legacy API は符号付き金額に逆符号化する
  return rows.map((t) => ({
    externalId: t.externalId,
    accountId: t.accountId,
    date: t.date,
    description: t.description,
    amount: t.type === "expense" ? -t.amount : t.amount,
    category: t.category,
  }));
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
      income: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)`,
      expense: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)`,
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
