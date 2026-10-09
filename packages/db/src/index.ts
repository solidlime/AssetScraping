// Next.js webpack は ESM 拡張子付き相対 import を解決しないため拡張子なしで書く。
// tsc --noEmit は db パッケージ内で moduleResolution bundler ではないため…
// → 解決策: tsconfig で allowImportingTsExtensions を使わず、re-export は型レベルで行う
export * from "./client.ts";
export * from "./schema.ts";
export * from "./repo.ts";
// 本家 mf-dashboard 互換レイヤー
export type {
  AccountType,
  AccountStatusType,
  HoldingType,
  TransactionType,
  CashFlowItem,
  CashFlowSummary,
  PortfolioItem,
  Portfolio,
  LiabilityItem,
  Group,
  SpendingTargetsData,
  ScrapedData,
} from "./types.ts";
export {
  toAccountStatusType,
  type AssetHistoryPoint as MfAssetHistoryPoint,
  type AssetHistory as MfAssetHistory,
} from "./types.ts";

export * from "./utils.ts";

// Shared utilities
export * from "./shared/group-filter.ts";
export * from "./shared/transfer.ts";
export * from "./shared/utils.ts";

// Repositories（repo.ts と名前衝突するものは mf* エイリアスで re-export）
export {
  upsertAccount as mfUpsertAccount,
  saveAccountStatus,
  saveAccountStatuses,
  updateAccountCategory,
  buildAccountIdMap,
  upsertAccounts,
} from "./repositories/accounts.ts";
export * from "./repositories/categories.ts";
export * from "./repositories/settings.ts";
export * from "./repositories/groups.ts";
export * from "./repositories/holdings.ts";
export * from "./repositories/institution-categories.ts";
export * from "./repositories/snapshots.ts";
export * from "./repositories/transactions.ts";

// Query modules（repo.ts と名前衝突するものは mf* エイリアスで re-export）
export * from "./queries/groups.ts";
export {
  getTransactionsByMonth,
  getTransactionsByAccountId,
  getTransactions as getMfTransactions,
} from "./queries/transaction.ts";
export * from "./queries/summary.ts";
export * from "./queries/account.ts";
export {
  parseDateString,
  toDateString,
  calculateTargetDate,
  getAssetBreakdownByCategory,
  aggregateLiabilitiesByCategory,
  getLiabilityBreakdownByCategory,
  getAssetHistoryWithCategories,
  getLatestTotalAssets,
  getDailyAssetChange,
  calculateCategoryChanges,
  getCategoryChangesForPeriod,
  getAssetHistory as getMfAssetHistory,
} from "./queries/asset.ts";
export * from "./queries/holding.ts";
export {
  getFinancialMetrics,
  calculateHealthScore,
  isLiquidAssetCategory,
  isInvestmentCategory,
  type AnalyticsMetrics,
} from "./queries/analytics.ts";
