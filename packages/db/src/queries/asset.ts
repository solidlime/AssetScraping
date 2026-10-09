import {
  addDaysToIsoDateKey,
  formatIsoDateKey,
  getEndOfPreviousMonthIsoDateKey,
  parseIsoDateKey,
} from "@asset-scraping/date-utils";
// asset_history アダプタ化により desc/eq/sql/and は未使用
import { getDb, type Db, schema } from "../index.ts";
// groupId は単一ユーザー運用のため全行対象（resolveGroupId は本家シグネチャ互換用プレースホルダ）
import { getHoldingsWithLatestValues } from "./holding.ts";

/**
 * 日付文字列をパース
 */
export function parseDateString(dateStr: string): { year: number; month: number; day: number } {
  return parseIsoDateKey(dateStr);
}

/**
 * 日付文字列を生成
 */
export function toDateString(year: number, month: number, day: number): string {
  return formatIsoDateKey({ year, month, day });
}

/**
 * 比較対象の日付を計算
 */
export function calculateTargetDate(
  latestDate: string,
  period: "daily" | "weekly" | "monthly",
): string {
  if (period === "monthly") {
    return getEndOfPreviousMonthIsoDateKey(latestDate);
  }

  const daysAgo = period === "daily" ? 1 : 8;
  return addDaysToIsoDateKey(latestDate, -daysAgo);
}

/**
 * ============================================================================
 * asset_history アダプタ（薄いアダプタ関数）
 * ----------------------------------------------------------------------------
 * 現行の asset_history は (date, category, value) の日次×カテゴリ行であり、
 * 本家 mf-dashboard の asset_history（group×date 1行 + asset_history_categories 子テーブル）
 * と行構造が異なる。
 *
 * 本家の asset_history_categories を参照する queries が同じ呼び出し形で
 * 動くよう、現行テーブルから {date, totalAssets, change, categories} を導出する
 * アダプタに差し替えてある。groupId 引数は本家互換のシグネチャ維持用
 * （本システムは単一ユーザー運用のため全行対象）。
 * ============================================================================
 */

/** 日次の資産履歴 1 日分（本家 asset_history 1 行 + asset_history_categories に相当） */
export interface AssetHistoryDay {
  date: string;
  totalAssets: number;
  /** 前日比（円）。初日は null */
  change: number | null;
  categories: Array<{ categoryName: string; amount: number }>;
}

/** 現行 asset_history (date, category, value) を日次単位へ集約（date 昇順） */
export async function getAssetHistoryByDay(
  db: Db = getDb(),
): Promise<AssetHistoryDay[]> {
  const rows = db
    .select({
      date: schema.assetHistory.date,
      category: schema.assetHistory.category,
      value: schema.assetHistory.value,
    })
    .from(schema.assetHistory)
    .orderBy(schema.assetHistory.date, schema.assetHistory.category)
    .all();

  const days: AssetHistoryDay[] = [];
  for (const row of rows) {
    const latest = days[days.length - 1];
    if (!latest || latest.date !== row.date) {
      days.push({
        date: row.date,
        totalAssets: 0,
        change: null,
        categories: [],
      });
    }
    const day = days[days.length - 1]!;
    day.categories.push({ categoryName: row.category, amount: row.value });
    day.totalAssets += row.value;
  }

  for (let i = days.length - 1; i >= 1; i--) {
    days[i]!.change = days[i]!.totalAssets - days[i - 1]!.totalAssets;
  }

  return days;
}

/**
 * カテゴリ別資産内訳を取得（本家 getAssetBreakdownByCategory 相当）
 * 本家は最新 asset_history の asset_history_categories（categoryName は
 * holdings の assetCategory・本家語彙）を返すため、現行も同値の
 * holdings.categoryId → categoryName 駆動に統一する。
 * （日×カテゴリ行の asset_history は口座コード語彙のため、ここでの集計には使わない）
 */
export function aggregateAssetsByCategory(
  holdings: Array<{ type: string; categoryName: string | null; amount: number | null }>,
) {
  const breakdown: Record<string, number> = {};

  for (const holding of holdings) {
    if (holding.type === "asset" && holding.amount) {
      const category = holding.categoryName || "その他";
      breakdown[category] = (breakdown[category] || 0) + holding.amount;
    }
  }

  return Object.entries(breakdown)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export async function getAssetBreakdownByCategory(
  groupIdParam?: string,
  db: Db = getDb(),
) {
  const holdings = await getHoldingsWithLatestValues(groupIdParam, db);
  return aggregateAssetsByCategory(holdings);
}

/**
 * 資産履歴を取得（本家 getAssetHistory 相当）
 * {date, totalAssets, change} を最新日降順で返す
 */
export async function getAssetHistory(
  options?: { limit?: number; groupId?: string },
  db: Db = getDb(),
) {
  const days = await getAssetHistoryByDay(db);
  const entries = [...days]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => ({ date: d.date, totalAssets: d.totalAssets, change: d.change ?? 0 }));

  if (options?.limit) {
    return entries.slice(0, options.limit);
  }
  return entries;
}

/**
 * カテゴリ情報付き資産履歴を取得（本家 getAssetHistoryWithCategories 相当）
 */
export async function getAssetHistoryWithCategories(
  options?: { limit?: number; groupId?: string },
  db: Db = getDb(),
) {
  const days = await getAssetHistoryByDay(db);
  const entries = [...days]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => {
      const categories: Record<string, number> = {};
      for (const cat of d.categories) {
        categories[cat.categoryName] = cat.amount;
      }
      return { date: d.date, totalAssets: d.totalAssets, categories };
    });

  if (options?.limit) {
    return entries.slice(0, options.limit);
  }
  return entries;
}

/**
 * 最新の総資産を取得（本家 getLatestTotalAssets 相当）
 */
export async function getLatestTotalAssets(
  _groupIdParam?: string,
  db: Db = getDb(),
): Promise<number | null> {
  const days = await getAssetHistoryByDay(db);
  const latest = days[days.length - 1];
  return latest ? latest.totalAssets : null;
}

/**
 * 日次資産変動を取得（今日 vs 昨日。本家 getDailyAssetChange 相当）
 */
export async function getDailyAssetChange(_groupIdParam?: string, db: Db = getDb()) {
  const days = await getAssetHistoryByDay(db);
  if (days.length < 2) {
    return null;
  }

  const latest = days[days.length - 1]!;
  const previous = days[days.length - 2]!;

  return {
    today: latest.totalAssets,
    yesterday: previous.totalAssets,
    change: latest.totalAssets - previous.totalAssets,
  };
}

/**
 * 負傷を種別別に集計（本家 aggregateLiabilitiesByCategory 相当・純粋関数）
 */
export function aggregateLiabilitiesByCategory(
  holdings: Array<{
    type: string;
    liabilityCategory: string | null;
    amount: number | null;
  }>,
) {
  const breakdown: Record<string, number> = {};

  for (const holding of holdings) {
    if (holding.type === "liability" && holding.amount) {
      const category = holding.liabilityCategory || "その他";
      breakdown[category] = (breakdown[category] || 0) + holding.amount;
    }
  }

  return Object.entries(breakdown)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * カテゴリ別負傷内訳を取得（本家 getLiabilityBreakdownByCategory 相当）
 */
export async function getLiabilityBreakdownByCategory(
  groupIdParam?: string,
  db: Db = getDb(),
) {
  const holdings = await getHoldingsWithLatestValues(groupIdParam, db);
  return aggregateLiabilitiesByCategory(holdings);
}

/**
 * カテゴリ変動を計算（本家 calculateCategoryChanges 相当・純粋関数）
 */
export function calculateCategoryChanges(
  latestCategories: Array<{ categoryName: string; amount: number }>,
  previousCategories: Array<{ categoryName: string; amount: number }>,
) {
  const latestMap = new Map(latestCategories.map((c) => [c.categoryName, c.amount]));
  const previousMap = new Map(previousCategories.map((c) => [c.categoryName, c.amount]));

  const allCategoryNames = new Set([...latestMap.keys(), ...previousMap.keys()]);

  return [...allCategoryNames]
    .map((name) => {
      const current = latestMap.get(name) ?? 0;
      const previous = previousMap.get(name) ?? 0;
      return { name, current, previous, change: current - previous };
    })
    .filter((cat) => cat.current > 0 || cat.previous > 0);
}

/**
 * 期間別カテゴリ変動を取得（本家 getCategoryChangesForPeriod 相当）
 * asset_history_categories の代わりに現行 asset_history の日次集約から計算する
 */
export async function getCategoryChangesForPeriod(
  period: "daily" | "weekly" | "monthly",
  _groupIdParam?: string,
  db: Db = getDb(),
) {
  const days = await getAssetHistoryByDay(db);
  const latest = days[days.length - 1];
  if (!latest) {
    return null;
  }

  const targetDateStr = calculateTargetDate(latest.date, period);

  // targetDate 以前（同一日を含まない）で最も新しい日
  let previousIndex = -1;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i]!.date < targetDateStr) {
      previousIndex = i;
      break;
    }
  }
  if (previousIndex < 0 || days[previousIndex]!.date === latest.date) {
    return null;
  }
  const previous = days[previousIndex]!;

  const categoryChanges = calculateCategoryChanges(latest.categories, previous.categories);

  return {
    categories: categoryChanges,
    total: {
      current: latest.totalAssets,
      previous: previous.totalAssets,
      change: latest.totalAssets - previous.totalAssets,
    },
  };
}
