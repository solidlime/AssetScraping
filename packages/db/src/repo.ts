import type {
  Account,
  AccountCategory,
  AccountStatus,
  AssetHistoryPoint,
  Holding,
  Transaction,
} from "@asset-scraping/shared";
import { buildTransactionExternalId } from "@asset-scraping/shared";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { categorizeDbTransaction } from "./shared/categorize.ts";
import type { Database } from "./client.ts";
import { getOrCreateCategory } from "./repositories/categories.ts";
import {
  accounts,
  accountStatuses,
  assetCategories,
  assetHistory,
  cashFlowPeriods,
  dailySnapshots,
  groupAccounts,
  groups,
  holdingValues,
  holdings,
  institutionCategories,
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
 * - unitPrice / avgCostPrice: quantity>0 のとき value/quantity・平均取得単価（表示用。算出には使わない）
 * - unrealizedGain / unrealizedGainPct: crawler がページから取得した値をそのまま保存（本家準拠）。
 *   **`(評価額/数量 − 平均取得単価) × 数量` で再計算してはならない**:
 *   投信の平均取得単価は 1万口あたり、米国株は現地通貨建てのため、単位が一致せず桁が壊れる
 *   （実測: eMAXIS Slim 全世界株式 27,021×81,789 = 22億円。正しくは ÷10,000 で 221,001円）。
 *   取得価額は `評価額 − 含み損益` で算出できる（実データ全行で一致）。
 *   crawler が unrealizedGain を取得できなかった場合のみ avgCostPrice から算出する。
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
      // 取得価額 = 評価額 − 含み損益。crawler が取得した値を第一に使い、
      // 無い場合のみ平均取得単価から算出する（crawler 側の算出も出所を検証済み）。
      const scrapedGain = h.unrealizedGain;
      const unrealizedGain =
        scrapedGain ??
        (avgCostPrice !== null && avgCostPrice > 0 && unitPrice !== null
          ? Math.round((unitPrice - avgCostPrice) * h.quantity)
          : null);
      // 取得価額（含み損益の母数）。投信・外貨建て銘柄でも桁が壊れないよう
      // 評価額と含み損益の差から求める。
      const costBasis = unrealizedGain !== null ? amount - unrealizedGain : null;
      const unrealizedGainPct =
        unrealizedGain !== null && costBasis !== null && costBasis > 0
          ? (unrealizedGain / costBasis) * 100
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
  // 本家互換の派生列: lastUpdated=scrapedAt / totalAssets=balance。
  // 更新状態は shared AccountStatus.status（parseAccounts が /accounts の更新状態列から判定）を反映。
  // 未指定（=検出不能・正常）は本家既定 "ok"。statusText は errorMessage 列に載せる。
  const status = input.status ?? "ok";
  const errorMessage = input.statusText ?? null;
  const values = {
    accountId: input.accountId,
    balance: input.balance,
    scrapedAt: input.scrapedAt,
    status,
    lastUpdated: input.scrapedAt,
    totalAssets: Math.round(input.balance),
    errorMessage,
    createdAt: ts,
    updatedAt: ts,
  };
  db.insert(accountStatuses)
    .values(values)
    .onConflictDoUpdate({
      target: accountStatuses.accountId,
      set: {
        balance: input.balance,
        scrapedAt: input.scrapedAt,
        status,
        lastUpdated: input.scrapedAt,
        totalAssets: Math.round(input.balance),
        errorMessage,
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
  // 本家 saveScrapedData の portfolio 保存相当: 銘柄の assetCategory（本家語彙）で
  // asset_categories を get-or-create し、holdings.categoryId に割当する。
  // /bs のカテゴリ集計（getAssetBreakdownByCategory・hasInvestmentHoldings）の前提。
  const categoryIdByName = new Map<string, number>();
  for (const h of rows) {
    if (h.assetCategory && !categoryIdByName.has(h.assetCategory)) {
      categoryIdByName.set(h.assetCategory, getOrCreateCategory(db, h.assetCategory));
    }
  }
  db.transaction((tx) => {
    for (const h of rows) {
      tx.insert(holdings)
        .values({
          accountId: h.accountId,
          name: h.name,
          categoryId: h.assetCategory ? (categoryIdByName.get(h.assetCategory) ?? null) : null,
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
            categoryId: h.assetCategory ? (categoryIdByName.get(h.assetCategory) ?? null) : null,
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

/**
 * 口座スコープの holdings から、今回の取得集合に無い name の行を削除する（stale cleanup）。
 * (account_id, name) の unique index により、パーサの名前規約が変わった旧世代の別名行は
 * upsert では消えない（実測: イオン/SBI新生等 7 口座の二重計上）。同一口座に限定して
 * 差集合を削除する。他の口座・他ソースは name 集合が違うため影響しない。
 *
 * 空集合では何もしない（パースが 0 件を返したときに口座の保有資産を全消しする事故を防ぐ）。
 *
 * 部分パースガード: ssnb が語彙を変えて「非空だが不完全」な name 集合を返すと、空集合
 * ガードをすり抜けて残りを全消しし、holding_values の FK cascade で過去スナップショット
 * ごと失う。削除見込み toDelete が max(2, floor(existing/2)) を超えるときは削除せず 0 を
 * 返して警告する（誤削除より旧行残りを選ぶ安全側）。
 * ponytail: 「今回 0 件」で旧行を消したい口座は prune されない。必要なら明示フラグで。
 * 返り値は削除件数。skip 時は 0（console.warn で判別可能）。
 */
export function pruneHoldingsByName(db: Database, accountId: string, keepNames: string[]): number {
  if (keepNames.length === 0) return 0;
  const keep = new Set(keepNames);
  const existing = db
    .select({ name: holdings.name })
    .from(holdings)
    .where(eq(holdings.accountId, accountId))
    .all();
  const toDelete = existing.filter((r) => !keep.has(r.name)).length;
  const threshold = Math.max(2, Math.floor(existing.length / 2));
  if (toDelete > threshold) {
    console.warn(
      `[pruneHoldingsByName] skip: accountId=${accountId} existing=${existing.length} toDelete=${toDelete} (部分パースの疑い)`,
    );
    return 0;
  }
  if (toDelete === 0) return 0;
  const result = db
    .delete(holdings)
    .where(and(eq(holdings.accountId, accountId), notInArray(holdings.name, keepNames)))
    .run();
  return result.changes;
}

/**
 * 旧世代の transactions（externalId IS NULL）を、同一内容の決定的 externalId 行と突合して整理する。
 *
 * 背景: commit 5030676 で parser は決定的 externalId を付与するようになったが、既存の
 * NULL 行は unique index (account_id, external_id) に衝突せず残り続け、月次サマリーが
 * 実支出の約 10 倍になっていた（実測 NAS: externalId あり 1 件 + null 11 件 等）。
 *
 * 判定根拠は (account_id, date, description, 符号付き金額) が完全一致すること。
 * - 決定的行がある内容の旧 NULL 行 → 新方式で再取得できる重複なので削除。
 *   同日同額同摘要の正当な複数回取引は occurrence 0..n-1 の決定的行として複数残るため消えない。
 * - 決定的行が無い内容の旧 NULL 行 → 新方式で拾えない取引の可能性があるので消さず、
 *   次回スクレイプの upsert が同一行に収束するよう決定的 externalId を付与する。
 */
export function dedupeLegacyTransactions(
  db: Database,
  opts: { dryRun?: boolean } = {},
): { deleted: number; reassigned: number } {
  const rows = db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      type: transactions.type,
      externalId: transactions.externalId,
    })
    .from(transactions)
    .all();

  // 保存規約の吸収: 旧データは type=null + 符号付き金額、新データは type=expense/income + 正値。
  const signed = (r: { amount: number; type: string | null }): number =>
    r.type === "expense" ? -Math.abs(r.amount) : r.type === "income" ? Math.abs(r.amount) : r.amount;

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.accountId}\u0000${r.date}\u0000${r.description}\u0000${signed(r)}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const deleteIds: number[] = [];
  const reassign: Array<{ id: number; externalId: string }> = [];
  for (const group of groups.values()) {
    const legacy = group.filter((r) => r.externalId === null).sort((a, b) => a.id - b.id);
    if (legacy.length === 0) continue;
    const deterministic = group.some((r) => r.externalId !== null);
    if (deterministic) {
      for (const r of legacy) deleteIds.push(r.id);
      continue;
    }
    const amount = signed(legacy[0]!);
    legacy.forEach((r, occurrence) => {
      reassign.push({
        id: r.id,
        externalId: buildTransactionExternalId(r.accountId, r.date, r.description, amount, occurrence),
      });
    });
  }

  if (opts.dryRun) return { deleted: deleteIds.length, reassigned: reassign.length };

  db.transaction((tx) => {
    if (deleteIds.length > 0) {
      tx.delete(transactions).where(inArray(transactions.id, deleteIds)).run();
    }
    for (const { id, externalId } of reassign) {
      tx.update(transactions)
        .set({ externalId, mfId: externalId, updatedAt: nowIso() })
        .where(eq(transactions.id, id))
        .run();
    }
  });
  return { deleted: deleteIds.length, reassigned: reassign.length };
}

export function upsertTransactions(db: Database, rows: Transaction[]): void {
  if (rows.length === 0) return;
  const ts = nowIso();
  // ssnb は取引 ID を返さないため externalId が null になり得る。SQLite は
  // unique index (account_id, external_id) の NULL を「重複なし」と扱うため、
  // NULL のまま insert すると再スクレイプ毎に追記される。
  // 内容（日付・摘要・金額）+ バッチ内出現回数で決定的な externalId を合成し、
  // 同日同額同摘要の正当な重複も occurrence で区別して保持する。
  const occurrenceByContent = new Map<string, number>();
  db.transaction((tx) => {
    for (const t of rows) {
      // 本家準拠: transactions.amount は常に正値、type で収支を区別する。
      // crawler 由来の符号はここで吸収し、読み出し側（getTransactions）で逆符号化する。
      const amount = Math.abs(t.amount);
      const type = t.amount >= 0 ? "income" : "expense";
      let externalId = t.externalId;
      if (!externalId) {
        const contentKey = `${t.accountId}\u0000${t.date}\u0000${t.description}\u0000${t.amount}`;
        const occurrence = occurrenceByContent.get(contentKey) ?? 0;
        occurrenceByContent.set(contentKey, occurrence + 1);
        externalId = buildTransactionExternalId(
          t.accountId,
          t.date,
          t.description,
          t.amount,
          occurrence,
        );
      }
      // ssnb に大項目・中項目が無い行は内容ベース推定で補完する（crawler categorize.ts
      // と同じ本家 seed カテゴリ体系。db 側に重複実装しないため、
      // crawler 側がすでに推定済みなら t.category / t.subCategory を優先する）。
      const fallback = t.category === null ? categorizeDbTransaction(t.description) : null;
      const category = t.category ?? fallback?.category ?? null;
      const subCategory = t.subCategory ?? fallback?.subCategory ?? null;
      tx.insert(transactions)
        .values({
          externalId,
          mfId: externalId,
          accountId: t.accountId,
          date: t.date,
          description: t.description,
          amount,
          category,
          subCategory,
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
            category,
            subCategory,
            type,
            updatedAt: ts,
          },
        })
        .run();
    }
  });
}

// asset_history の旧語彙（AccountCategory）行を掃除する。
// 現行の category は /bs/history のヘッダラベル語彙（例: 株式(現物)・預金・現金）であり、
// 旧語彙行が同一日に残ると totalAssets の加算と getAssetHistoryByDay の
// categories に二重計上される（例: bank 行 + 預金・現金 行）。
// 次回スクレイプで新語彙に置き換わるまでの移行措置。冪等。
const LEGACY_ASSET_HISTORY_CATEGORIES = [
  "bank",
  "securities",
  "cash",
  "point",
  "crypto",
  "pension",
  "real_estate",
  "other",
];

export function upsertAssetHistory(db: Database, rows: AssetHistoryPoint[]): void {
  if (rows.length === 0) return;
  db.transaction((tx) => {
    // 旧語彙行を先に消す（新語彙と同一日で共存すると二重計上になるため）
    tx.delete(assetHistory)
      .where(inArray(assetHistory.category, LEGACY_ASSET_HISTORY_CATEGORIES))
      .run();

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
  return rows.map((r) => ({ ...r, category: r.category }));
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

/** 月次収支 1行分（本家 cash_flow_periods 集計 + 収入/支出/収支） */
export interface CashFlowPeriodInput {
  /** YYYY-MM */
  month: string;
  periodStart: string;
  periodEnd: string;
  transactionCount: number;
}

/**
 * crawler 用 default group seeding。
 * 本家 queries は groupId 前提のため、crawler 側で固定 "default" グループを保証する。
 */
export const DEFAULT_GROUP_ID = "default";

/** groups に固定 default 行を冪等 upsert する */
export function ensureDefaultGroup(db: Database): void {
  const ts = nowIso();
  db
    .insert(groups)
    .values({
      id: DEFAULT_GROUP_ID,
      name: DEFAULT_GROUP_ID,
      isCurrent: true,
      createdAt: ts,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: groups.id,
      set: { isCurrent: true, updatedAt: ts },
    })
    .run();
}

// ---------------------------------------------------------------------------
// institution_categories seed + accounts.category_id 自動割当
// ---------------------------------------------------------------------------

/**
 * 本家 mf-dashboard packages/db/src/seed/accounts.ts institutionCategoryDefs の移植。
 * displayOrder も本家値を維持する（web のカテゴリ表示順が本家と同じになる）。
 */
export interface InstitutionCategoryDef {
  name: string;
  order: number;
}

export const INSTITUTION_CATEGORY_DEFS: InstitutionCategoryDef[] = [
  { name: "銀行", order: 1 },
  { name: "証券", order: 2 },
  { name: "暗号資産・FX・貴金属", order: 3 },
  { name: "カード", order: 4 },
  { name: "年金", order: 5 },
  { name: "電子マネー・プリペイド", order: 6 },
  { name: "ポイント", order: 7 },
  { name: "携帯", order: 8 },
  { name: "通販", order: 9 },
  { name: "貯蓄", order: 10 },
];

/** 判定不能だった口座の割当先（本家 defs に無い追加カテゴリ。bs 集計から漏れさせない） */
export const OTHER_INSTITUTION_CATEGORY = "その他";

/**
 * institution_categories に本家 seed + 「その他」を冪等投入する。
 * 本家 seed.ts の「機関カテゴリ」節相当（crawler の scrape 時に毎回保証する）。
 * 戻り値は投入後の全カテゴリ行数。
 */
export function ensureInstitutionCategories(db: Database): number {
  const ts = nowIso();
  const defs: InstitutionCategoryDef[] = [
    ...INSTITUTION_CATEGORY_DEFS,
    { name: OTHER_INSTITUTION_CATEGORY, order: INSTITUTION_CATEGORY_DEFS.length + 1 },
  ];
  db
    .insert(institutionCategories)
    .values(
      defs.map((d) => ({
        name: d.name,
        displayOrder: d.order,
        createdAt: ts,
        updatedAt: ts,
      })),
    )
    .onConflictDoUpdate({
      target: institutionCategories.name,
      set: { displayOrder: sql`excluded.display_order`, updatedAt: ts },
    })
    .run();
  return db.select({ id: institutionCategories.id }).from(institutionCategories).all().length;
}

/**
 * 金融機関名 → 本家カテゴリ名の推定。
 * 本家は MF 画面側の見出し（.heading-category-name）から取るため推定不要だが、
 * ssnb には画面上のカテゴリ見出しが無いため内容ベースで写像する。
 * 判定不能は null（呼び出し側で OTHER_INSTITUTION_CATEGORY にフォールバック）。
 */
const INSTITUTION_CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ["銀行", ["銀行", "労働金庫", "労金", "信用金庫", "信金", "ＳＭＢＣ", "smtb"]],
  ["年金", ["確定拠出年金", "ideco", "ideco", "年金"]],
  ["暗号資産・FX・貴金属", ["coincheck", "zaif", "bitflyer", "gmoコイン", "暗号資産", "仮想通貨"]],
  ["証券", ["証券", "楽天ｓ", "raKuten securities"]],
  ["ポイント", ["ポイント", "楽天市場", "rakuten"]],
  ["電子マネー・プリペイド", ["suica", "メルペイ", "nanaco", "waon", "楽天キャッシュ"]],
  ["携帯", ["docomo", "ドコモ", "ahamo", "au", "楽天モバイル"]],
  ["カード", ["カード", "card"]],
];

export function guessInstitutionCategory(institution: string): string | null {
  const normalized = institution.toLowerCase();
  for (const [name, keywords] of INSTITUTION_CATEGORY_KEYWORDS) {
    if (keywords.some((k) => normalized.includes(k))) return name;
  }
  return null;
}

/**
 * accounts.category_id が null の行だけを institution 名マッチ → 推定で自動割当する。
 * 既存の category_id は保持する（本家 updateAccountCategory は明示上書き用、こちらは初期填充用）。
 * 戻り値は割当した行数。
 */
export function assignAccountCategories(db: Database): number {
  const cats = db
    .select({ id: institutionCategories.id, name: institutionCategories.name })
    .from(institutionCategories)
    .all();
  if (cats.length === 0) return 0;

  const byName = new Map(cats.map((c) => [c.name, c.id]));
  const otherId = byName.get(OTHER_INSTITUTION_CATEGORY);
  const rows = db
    .select({ id: accounts.id, institution: accounts.institution })
    .from(accounts)
    .where(isNull(accounts.categoryId))
    .all();

  const ts = nowIso();
  let assigned = 0;
  for (const row of rows) {
    const guessed = guessInstitutionCategory(row.institution);
    const categoryId =
      (guessed !== null ? byName.get(guessed) : undefined) ?? otherId ?? null;
    if (categoryId === null) continue;
    db
      .update(accounts)
      .set({ categoryId, updatedAt: ts })
      .where(eq(accounts.id, row.id))
      .run();
    assigned++;
  }
  return assigned;
}

/** 全 accounts を default group に冪等リンクする */
export function linkAllAccountsToDefaultGroup(db: Database): void {
  const accountIds = db.select({ id: accounts.id }).from(accounts).all();
  if (accountIds.length === 0) return;
  const ts = nowIso();
  db
    .insert(groupAccounts)
    .values(accountIds.map((a) => ({ groupId: DEFAULT_GROUP_ID, accountId: a.id, createdAt: ts, updatedAt: ts })))
    .onConflictDoNothing()
    .run();
}

/**
 * 本家互換 cash_flow_periods の冪等 upsert（月単位、既存月は再計算で上書き）。
 * crawler が transactions 保存後に呼び出す。本家 queries は month で駆動する。
 */
export function upsertCashFlowPeriods(
  db: Database,
  periods: CashFlowPeriodInput[],
): number {
  if (periods.length === 0) return 0;
  const ts = nowIso();
  db.transaction((tx) => {
    for (const p of periods) {
      tx
        .insert(cashFlowPeriods)
        .values({ ...p, createdAt: ts, updatedAt: ts })
        .onConflictDoUpdate({
          target: cashFlowPeriods.month,
          set: {
            periodStart: p.periodStart,
            periodEnd: p.periodEnd,
            transactionCount: p.transactionCount,
            updatedAt: ts,
          },
        })
        .run();
    }
  });
  return periods.length;
}

/**
 * transactions から月次 periods を集計して cash_flow_periods に冪等 upsert する。
 * 既存月は再計算で上書き。戻り値は書き込み件数（月数）。
 */
export function regenerateCashFlowPeriods(db: Database): number {
  const rows = db
    .select({
      month: sql<string>`substr(${transactions.date}, 1, 7)`.as("month"),
      periodStart: sql<string>`min(${transactions.date})`.as("period_start"),
      periodEnd: sql<string>`max(${transactions.date})`.as("period_end"),
      transactionCount: sql<number>`count(*)`.as("transaction_count"),
    })
    .from(transactions)
    .groupBy(sql`substr(${transactions.date}, 1, 7)`)
    .all();

  return upsertCashFlowPeriods(
    db,
    rows.map((r) => ({
      month: r.month,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      transactionCount: Number(r.transactionCount),
    })),
  );
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
