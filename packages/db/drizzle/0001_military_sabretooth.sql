CREATE TABLE `asset_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_categories_name_unique` ON `asset_categories` (`name`);--> statement-breakpoint
CREATE TABLE `asset_history_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_history_id` integer NOT NULL,
	`category_name` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`asset_history_id`) REFERENCES `asset_history`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_history_categories_history_category_idx` ON `asset_history_categories` (`asset_history_id`,`category_name`);--> statement-breakpoint
CREATE TABLE `cash_flow_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`transaction_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_flow_periods_month_idx` ON `cash_flow_periods` (`month`);--> statement-breakpoint
CREATE TABLE `group_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` text NOT NULL,
	`account_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_accounts_group_account_idx` ON `group_accounts` (`group_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `group_accounts_group_id_idx` ON `group_accounts` (`group_id`);--> statement-breakpoint
CREATE INDEX `group_accounts_account_id_idx` ON `group_accounts` (`account_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_current` integer DEFAULT false,
	`last_scraped_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holding_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`holding_id` integer NOT NULL,
	`snapshot_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`quantity` real,
	`unit_price` real,
	`avg_cost_price` real,
	`daily_change` integer,
	`unrealized_gain` integer,
	`unrealized_gain_pct` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `daily_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holding_values_holding_snapshot_idx` ON `holding_values` (`holding_id`,`snapshot_id`);--> statement-breakpoint
CREATE TABLE `institution_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`display_order` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `institution_categories_name_unique` ON `institution_categories` (`name`);--> statement-breakpoint
ALTER TABLE `account_statuses` ADD `status` text;--> statement-breakpoint
ALTER TABLE `account_statuses` ADD `last_updated` text;--> statement-breakpoint
ALTER TABLE `account_statuses` ADD `total_assets` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `account_statuses` ADD `scheduled_withdrawal_amount` integer;--> statement-breakpoint
ALTER TABLE `account_statuses` ADD `scheduled_withdrawal_confirmed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `account_statuses` ADD `error_message` text;--> statement-breakpoint
ALTER TABLE `account_statuses` ADD `created_at` text;--> statement-breakpoint
ALTER TABLE `account_statuses` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `mf_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `type` text DEFAULT '自動連携';--> statement-breakpoint
ALTER TABLE `accounts` ADD `category_id` integer REFERENCES institution_categories(id);--> statement-breakpoint
ALTER TABLE `accounts` ADD `is_active` integer DEFAULT true;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_mf_id_unique` ON `accounts` (`mf_id`);--> statement-breakpoint
CREATE INDEX `accounts_category_id_idx` ON `accounts` (`category_id`);--> statement-breakpoint
ALTER TABLE `asset_history` ADD `group_id` text REFERENCES groups(id);--> statement-breakpoint
ALTER TABLE `asset_history` ADD `total_assets` integer;--> statement-breakpoint
ALTER TABLE `asset_history` ADD `change` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `asset_history` ADD `updated_at` text;--> statement-breakpoint
CREATE INDEX `asset_history_group_id_idx` ON `asset_history` (`group_id`);--> statement-breakpoint
ALTER TABLE `daily_snapshots` ADD `group_id` text REFERENCES groups(id);--> statement-breakpoint
ALTER TABLE `daily_snapshots` ADD `refresh_completed` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `daily_snapshots` ADD `created_at` text;--> statement-breakpoint
ALTER TABLE `daily_snapshots` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `holdings` ADD `mf_id` text;--> statement-breakpoint
ALTER TABLE `holdings` ADD `category_id` integer REFERENCES asset_categories(id);--> statement-breakpoint
ALTER TABLE `holdings` ADD `code` text;--> statement-breakpoint
ALTER TABLE `holdings` ADD `type` text DEFAULT 'asset' NOT NULL;--> statement-breakpoint
ALTER TABLE `holdings` ADD `liability_category` text;--> statement-breakpoint
ALTER TABLE `holdings` ADD `is_active` integer DEFAULT true;--> statement-breakpoint
CREATE UNIQUE INDEX `holdings_mf_id_unique` ON `holdings` (`mf_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `mf_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `sub_category` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `type` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `is_transfer` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `is_excluded_from_calculation` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `transfer_target` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `transfer_target_account_id` text REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `updated_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_mf_id_unique` ON `transactions` (`mf_id`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_account_id_idx` ON `transactions` (`account_id`);