import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

// ============================================================================
// 本家 mf-dashboard 互換テーブル（追加のみ。既存テーブル・列は変更しない）
// ============================================================================

/**
 * 設定タブ用 key-value ストア。定期更新時刻・残高しきい値・ssnb 認証情報。
 * crawler が唯一の writer（web は proxy、mcp は read-only）。
 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isCurrent: integer("is_current", { mode: "boolean" }).default(false),
  lastScrapedAt: text("last_scraped_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const institutionCategories = sqliteTable("institution_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  displayOrder: integer("display_order"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const assetCategories = sqliteTable("asset_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** 本家 group_accounts と同構造。現行 accounts.id が text のため accountId のみ text 参照 */
export const groupAccounts = sqliteTable(
  "group_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("group_accounts_group_account_idx").on(table.groupId, table.accountId),
    index("group_accounts_group_id_idx").on(table.groupId),
    index("group_accounts_account_id_idx").on(table.accountId),
  ],
);

export const cashFlowPeriods = sqliteTable(
  "cash_flow_periods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    month: text("month").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("cash_flow_periods_month_idx").on(table.month)],
);

/** 本家 holding_values と同構造（snapshot 駆動の銘柄評価額） */
export const holdingValues = sqliteTable(
  "holding_values",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    holdingId: integer("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => dailySnapshots.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    quantity: real("quantity"),
    unitPrice: real("unit_price"),
    avgCostPrice: real("avg_cost_price"),
    dailyChange: integer("daily_change"),
    unrealizedGain: integer("unrealized_gain"),
    unrealizedGainPct: real("unrealized_gain_pct"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("holding_values_holding_snapshot_idx").on(table.holdingId, table.snapshotId),
  ],
);

/** 本家 asset_history_categories と同構造（資産履歴のカテゴリ別内訳） */
export const assetHistoryCategories = sqliteTable(
  "asset_history_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assetHistoryId: integer("asset_history_id")
      .notNull()
      .references(() => assetHistory.id, { onDelete: "cascade" }),
    categoryName: text("category_name").notNull(),
    amount: integer("amount").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("asset_history_categories_history_category_idx").on(
      table.assetHistoryId,
      table.categoryName,
    ),
  ],
);

/**
 * 口座マスタ。crawler が upsert、web/mcp は参照のみ。
 * 本家互換列（mfId / type / categoryId / isActive）を追加で持つ。
 * 本家との差分: PK が text（ssnb 口座 ID）。本家は integer autoincrement + mfId 別列。
 */
export const accounts = sqliteTable(
  "accounts",
  {
    /** ssnb 上の口座 ID（文字列） */
    id: text("id").primaryKey(),
    /** 本家互換: MF の識別子。現行データは id と同値を投入する想定（未投入行は null） */
    mfId: text("mf_id").unique(),
    name: text("name").notNull(),
    institution: text("institution").notNull().default(""),
    /** 本家互換: "自動連携" / "手動" */
    type: text("type").default("自動連携"),
    /** shared の AccountCategory */
    category: text("category").notNull(),
    /** 本家互換: institution_categories 参照 */
    categoryId: integer("category_id").references(() => institutionCategories.id, {
      onDelete: "set null",
    }),
    /** 本家互換 */
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("accounts_category_id_idx").on(t.categoryId)],
);

/**
 * 口座別現在残高。scrape ごとに upsert（各口座最新 1 行）。
 * 本家互換のステータス列（status / totalAssets 等）を追加で持つ。
 */
export const accountStatuses = sqliteTable(
  "account_statuses",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    balance: real("balance").notNull(),
    scrapedAt: text("scraped_at").notNull(),
    /** 本家互換: "ok" / "error" / "updating" / "suspended" / "unknown" */
    status: text("status"),
    /** 本家互換: ISO 8601 */
    lastUpdated: text("last_updated"),
    /** 本家互換: /accounts ページから取得した資産額 */
    totalAssets: integer("total_assets").default(0),
    scheduledWithdrawalAmount: integer("scheduled_withdrawal_amount"),
    scheduledWithdrawalConfirmed: integer("scheduled_withdrawal_confirmed", { mode: "boolean" })
      .notNull()
      .default(false),
    errorMessage: text("error_message"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
);

/**
 * 保有資産（銘柄・数量・評価額・含み損益）。
 * (accountId, name) 単位で upsert。履歴は daily_snapshots / asset_history 側に持つ。
 * 本家互換列（mfId / categoryId / code / type / liabilityCategory / isActive）を追加で持つ。
 */
export const holdings = sqliteTable(
  "holdings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** 本家互換: MF の識別子（ない場合もある） */
    mfId: text("mf_id").unique(),
    /** 本家互換: asset_categories 参照（負債は null） */
    categoryId: integer("category_id").references(() => assetCategories.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    /** 本家互換: 銘柄コード（株式のみ） */
    code: text("code"),
    /** 本家互換: "asset" | "liability"。現行データは asset */
    type: text("type").notNull().default("asset"),
    /** 本家互換: 負債のカテゴリ（カード、ローン等） */
    liabilityCategory: text("liability_category"),
    /** 本家互換 */
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    /** 本家互換（nullable 追加。本家は notNull） */
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    quantity: real("quantity").notNull(),
    value: real("value").notNull(),
    averagePrice: real("average_price"),
    unrealizedGain: real("unrealized_gain"),
    scrapedAt: text("scraped_at").notNull(),
  },
  (t) => [uniqueIndex("holdings_account_name_idx").on(t.accountId, t.name)],
);

/**
 * 日次スナップショット（口座別）。1日1口座1行、同日再実行は上書き。
 * 本家互換列（groupId / refreshCompleted / createdAt / updatedAt）を追加で持つ。
 */
export const dailySnapshots = sqliteTable(
  "daily_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** 本家互換: groups 参照（本家はグループ単位 1 行。現行は口座単位） */
    groupId: text("group_id").references(() => groups.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD (JST) */
    date: text("date").notNull(),
    balance: real("balance").notNull(),
    /** 本家互換 */
    refreshCompleted: integer("refresh_completed", { mode: "boolean" }).default(true),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("daily_snapshots_account_date_idx").on(t.accountId, t.date)],
);

/**
 * 取引履歴。(accountId, externalId / date+description) で重複排除。
 * 本家互換列（mfId / subCategory / type / isTransfer / isExcludedFromCalculation /
 * transferTarget / transferTargetAccountId）を追加で持つ。
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 本家互換: MF の取引 ID。現行は externalId と同値を投入する想定 */
    mfId: text("mf_id").unique(),
    /** ssnb 上の取引 ID。無い場合は null */
    externalId: text("external_id"),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    /** 本家互換: 中項目 */
    subCategory: text("sub_category"),
    description: text("description").notNull(),
    /** 出金は負の値に正規化 */
    amount: real("amount").notNull(),
    category: text("category"),
    /** 本家互換: "income" / "expense" / "transfer"。現行データは null（amount 符号で判定） */
    type: text("type"),
    /** 本家互換 */
    isTransfer: integer("is_transfer", { mode: "boolean" }).notNull().default(false),
    /** 本家互換: mf-grayout class */
    isExcludedFromCalculation: integer("is_excluded_from_calculation", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 本家互換: 振替先口座名 */
    transferTarget: text("transfer_target"),
    /** 本家互換: 振替先口座参照 */
    transferTargetAccountId: text("transfer_target_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
  },
  (t) => [
    uniqueIndex("transactions_external_id_idx").on(t.accountId, t.externalId),
    index("transactions_date_idx").on(t.date),
    index("transactions_account_id_idx").on(t.accountId),
  ],
);

/**
 * 資産推移（日次 × カテゴリ別、円）。1日1カテゴリ1行、同日は上書き。
 * 本家互換列（groupId / totalAssets / change）を追加で持つ。
 */
export const assetHistory = sqliteTable(
  "asset_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 本家互換: groups 参照。本家はグループ×日付 1 行。現行は日付×カテゴリ 1 行 */
    groupId: text("group_id").references(() => groups.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    /** shared の AccountCategory */
    category: text("category").notNull(),
    value: real("value").notNull(),
    /** 本家互換: その日の総資産 */
    totalAssets: integer("total_assets"),
    /** 本家互換: 前日比 */
    change: integer("change").default(0),
    updatedAt: text("updated_at"),
  },
  (t) => [
    uniqueIndex("asset_history_date_category_idx").on(t.date, t.category),
    index("asset_history_group_id_idx").on(t.groupId),
  ],
);
