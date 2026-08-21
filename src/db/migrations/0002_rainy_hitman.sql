CREATE TABLE `anon_rate_limits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`tokens_x_1000` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anon_rate_limits_key_idx` ON `anon_rate_limits` (`key`);