CREATE TABLE `dividend_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`ex_date` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dividend_events_symbol_ex_date_idx` ON `dividend_events` (`symbol`,`ex_date`);--> statement-breakpoint
CREATE TABLE `dividend_symbols` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`holding_name` text NOT NULL,
	`yahoo_symbol` text,
	`currency` text,
	`annual_distribution_per_unit` real,
	`pays_distribution` integer DEFAULT true,
	`note` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dividend_symbols_holding_name_unique` ON `dividend_symbols` (`holding_name`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`pair` text PRIMARY KEY NOT NULL,
	`rate` real NOT NULL,
	`fetched_at` text NOT NULL
);
