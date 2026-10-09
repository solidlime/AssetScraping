import { eq, and, isNotNull, inArray, max } from "drizzle-orm";
import { getDb, type Db, schema } from "../index.ts";
import { resolveGroupId, getAccountIdsForGroup } from "../shared/group-filter.ts";

const INVESTMENT_CATEGORIES = ["株式(現物)", "投資信託"];
const GLOBAL_GROUP_ID = "0";
const FALLBACK_ACCOUNT_MF_ID = "unknown";

async function getHoldingAccountIdsForGroup(db: Db, groupId: string): Promise<string[]> {
  const accountIds = await getAccountIdsForGroup(db, groupId);
  if (groupId !== GLOBAL_GROUP_ID) return accountIds;

  const fallbackAccount = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.mfId, FALLBACK_ACCOUNT_MF_ID))
    .get();

  if (!fallbackAccount || accountIds.includes(fallbackAccount.id)) return accountIds;
  return [...accountIds, fallbackAccount.id];
}

/**
 * 各 holding の最新 holding_values 行を駆動するサブクエリ。
 * 現行 daily_snapshots は口座別（1日1口座1行）であり、本家の
 * 「全アカウント共通で1行」前提が成立しないため、snapshot 単位ではなく
 * holding 単位で最新行を解決する。
 */
function latestHoldingValuesSubquery(db: Db) {
  return db
    .select({
      holdingId: schema.holdingValues.holdingId,
      snapshotId: max(schema.holdingValues.snapshotId).as("snapshotId"),
    })
    .from(schema.holdingValues)
    .groupBy(schema.holdingValues.holdingId)
    .as("latest_holding_values");
}

/**
 * 保有資産の最新値を取得
 * 各 holding の最新 holding_values（口座別 snapshot に対応）＋グループでフィルタリング
 */
export async function getHoldingsWithLatestValues(groupIdParam?: string, db: Db = getDb()) {
  const groupId = await resolveGroupId(db, groupIdParam);
  const accountIds = groupId ? await getHoldingAccountIdsForGroup(db, groupId) : [];

  const latest = latestHoldingValuesSubquery(db);

  return await db
    .select({
      id: schema.holdings.id,
      name: schema.holdings.name,
      type: schema.holdings.type,
      liabilityCategory: schema.holdings.liabilityCategory,
      categoryId: schema.holdings.categoryId,
      categoryName: schema.assetCategories.name,
      accountId: schema.holdings.accountId,
      accountName: schema.accounts.name,
      institution: schema.accounts.institution,
      amount: schema.holdingValues.amount,
      quantity: schema.holdingValues.quantity,
      unitPrice: schema.holdingValues.unitPrice,
      avgCostPrice: schema.holdingValues.avgCostPrice,
      dailyChange: schema.holdingValues.dailyChange,
      unrealizedGain: schema.holdingValues.unrealizedGain,
      unrealizedGainPct: schema.holdingValues.unrealizedGainPct,
    })
    .from(schema.holdingValues)
    .innerJoin(
      latest,
      and(
        eq(schema.holdingValues.holdingId, latest.holdingId),
        eq(schema.holdingValues.snapshotId, latest.snapshotId),
      ),
    )
    .innerJoin(schema.holdings, eq(schema.holdings.id, schema.holdingValues.holdingId))
    .leftJoin(schema.assetCategories, eq(schema.assetCategories.id, schema.holdings.categoryId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.holdings.accountId))
    .where(inArray(schema.holdings.accountId, accountIds))
    .all();
}

/**
 * 特定アカウントの保有資産を取得
 * アカウントがグループに所属しない場合は空配列を返す
 */
export async function getHoldingsByAccountId(
  accountId: string,
  groupIdParam?: string,
  db: Db = getDb(),
) {
  const groupId = await resolveGroupId(db, groupIdParam);
  if (!groupId) return [];

  const accountIds = await getAccountIdsForGroup(db, groupId);
  if (accountIds.length === 0 || !accountIds.includes(accountId)) return [];

  const latest = latestHoldingValuesSubquery(db);

  return await db
    .select({
      id: schema.holdings.id,
      name: schema.holdings.name,
      type: schema.holdings.type,
      liabilityCategory: schema.holdings.liabilityCategory,
      categoryName: schema.assetCategories.name,
      accountName: schema.accounts.name,
      institution: schema.accounts.institution,
      amount: schema.holdingValues.amount,
      quantity: schema.holdingValues.quantity,
      unitPrice: schema.holdingValues.unitPrice,
      avgCostPrice: schema.holdingValues.avgCostPrice,
      dailyChange: schema.holdingValues.dailyChange,
      unrealizedGain: schema.holdingValues.unrealizedGain,
      unrealizedGainPct: schema.holdingValues.unrealizedGainPct,
    })
    .from(schema.holdingValues)
    .innerJoin(
      latest,
      and(
        eq(schema.holdingValues.holdingId, latest.holdingId),
        eq(schema.holdingValues.snapshotId, latest.snapshotId),
      ),
    )
    .innerJoin(schema.holdings, eq(schema.holdings.id, schema.holdingValues.holdingId))
    .leftJoin(schema.assetCategories, eq(schema.assetCategories.id, schema.holdings.categoryId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.holdings.accountId))
    .where(eq(schema.holdings.accountId, accountId))
    .all();
}

export interface HoldingWithDailyChange {
  id: number;
  name: string;
  code: string | null;
  categoryName: string | null;
  accountName: string | null;
  dailyChange: number;
}

/**
 * 日次変動がある保有資産を取得
 * daily_changeがnullでないもののみ返す
 */
export async function getHoldingsWithDailyChange(
  groupIdParam?: string,
  db: Db = getDb(),
): Promise<HoldingWithDailyChange[]> {
  const groupId = await resolveGroupId(db, groupIdParam);
  const accountIds = groupId ? await getHoldingAccountIdsForGroup(db, groupId) : [];

  const latest = latestHoldingValuesSubquery(db);

  return (await db
    .select({
      id: schema.holdings.id,
      name: schema.holdings.name,
      code: schema.holdings.code,
      categoryName: schema.assetCategories.name,
      accountName: schema.accounts.name,
      dailyChange: schema.holdingValues.dailyChange,
    })
    .from(schema.holdingValues)
    .innerJoin(
      latest,
      and(
        eq(schema.holdingValues.holdingId, latest.holdingId),
        eq(schema.holdingValues.snapshotId, latest.snapshotId),
      ),
    )
    .innerJoin(schema.holdings, eq(schema.holdings.id, schema.holdingValues.holdingId))
    .leftJoin(schema.assetCategories, eq(schema.assetCategories.id, schema.holdings.categoryId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.holdings.accountId))
    .where(
      and(
        inArray(schema.holdings.accountId, accountIds),
        isNotNull(schema.holdingValues.dailyChange),
      ),
    )
    .all()) as HoldingWithDailyChange[];
}

/**
 * 投資銘柄を保有しているかチェック
 */
export async function hasInvestmentHoldings(groupIdParam?: string, db: Db = getDb()) {
  const holdings = await getHoldingsWithLatestValues(groupIdParam, db);
  return holdings.some(
    (h) => h.categoryName !== null && INVESTMENT_CATEGORIES.includes(h.categoryName),
  );
}
