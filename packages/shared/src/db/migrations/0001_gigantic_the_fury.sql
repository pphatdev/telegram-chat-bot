CREATE TABLE `broadcast_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`broadcast_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`attempted_at` integer,
	`sent_at` integer,
	`failure_reason` text,
	`message_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`broadcast_id`) REFERENCES `broadcasts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `broadcast_targets_broadcast_status_idx` ON `broadcast_targets` (`broadcast_id`,`status`);--> statement-breakpoint
CREATE INDEX `broadcast_targets_next_attempt_idx` ON `broadcast_targets` (`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `callback_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` integer NOT NULL,
	`chat_id` integer,
	`telegram_callback_id` text NOT NULL,
	`from_telegram_id` integer NOT NULL,
	`data` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `callback_events_bot_created_idx` ON `callback_events` (`bot_id`,`created_at`);--> statement-breakpoint
DROP INDEX `broadcasts_bot_run_idx`;--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `next_attempt_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `broadcasts_bot_idempotency_idx` ON `broadcasts` (`bot_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `broadcasts_sweep_idx` ON `broadcasts` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `broadcasts_bot_created_idx` ON `broadcasts` (`bot_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `passcode_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `passcode_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `auto_lock_minutes` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_admin` integer DEFAULT false NOT NULL;