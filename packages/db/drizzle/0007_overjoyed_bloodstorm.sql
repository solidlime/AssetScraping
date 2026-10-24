ALTER TABLE `accounts` ADD `withdrawal_account_id` text REFERENCES accounts(id) ON DELETE SET NULL;
