CREATE TABLE `account_statuses` (
	`account_id` text PRIMARY KEY NOT NULL,
	`balance` real NOT NULL,
	`scraped_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`institution` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `asset_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`value` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_history_date_category_idx` ON `asset_history` (`date`,`category`);--> statement-breakpoint
CREATE TABLE `daily_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`balance` real NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_snapshots_account_date_idx` ON `daily_snapshots` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real NOT NULL,
	`value` real NOT NULL,
	`average_price` real,
	`unrealized_gain` real,
	`scraped_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holdings_account_name_idx` ON `holdings` (`account_id`,`name`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`amount` real NOT NULL,
	`category` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_external_id_idx` ON `transactions` (`account_id`,`external_id`);