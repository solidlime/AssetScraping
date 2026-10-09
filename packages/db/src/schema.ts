import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * 口座マスタ。crawler が upsert、web/mcp は参照のみ。
 */
export const accounts = sqliteTable(
  "accounts",
  {
    /** ssnb 上の口座 ID（文字列） */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    institution: text("institution").notNull().default(""),
    /** shared の AccountCategory */
    category: text("category").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

/**
 * 口座別現在残高。scrape ごとに upsert（各口座最新 1 行）。
 */
export const accountStatuses = sqliteTable(
  "account_statuses",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    balance: real("balance").notNull(),
    scrapedAt: text("scraped_at").notNull(),
  },
);

/**
 * 保有資産（銘柄・数量・評価額・含み損益）。
 * (accountId, name) 単位で upsert。履歴は daily_snapshots / asset_history 側に持つ。
 */
export const holdings = sqliteTable(
  "holdings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
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
 */
export const dailySnapshots = sqliteTable(
  "daily_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD (JST) */
    date: text("date").notNull(),
    balance: real("balance").notNull(),
  },
  (t) => [uniqueIndex("daily_snapshots_account_date_idx").on(t.accountId, t.date)],
);

/**
 * 取引履歴。(accountId, externalId / date+description) で重複排除。
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** ssnb 上の取引 ID。無い場合は null */
    externalId: text("external_id"),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    description: text("description").notNull(),
    /** 出金は負の値に正規化 */
    amount: real("amount").notNull(),
    category: text("category"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("transactions_external_id_idx").on(t.accountId, t.externalId),
  ],
);

/**
 * 資産推移（日次 × カテゴリ別、円）。1日1カテゴリ1行、同日は上書き。
 */
export const assetHistory = sqliteTable(
  "asset_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    /** shared の AccountCategory */
    category: text("category").notNull(),
    value: real("value").notNull(),
  },
  (t) => [uniqueIndex("asset_history_date_category_idx").on(t.date, t.category)],
);
