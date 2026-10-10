CREATE TABLE `cash_flow_monthly` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`row_name` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_flow_monthly_month_row_name_idx` ON `cash_flow_monthly` (`month`,`row_name`);