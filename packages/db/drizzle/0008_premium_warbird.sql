CREATE TABLE `scheduled_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`withdrawal_day` integer NOT NULL,
	`withdrawal_account_id` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`withdrawal_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
