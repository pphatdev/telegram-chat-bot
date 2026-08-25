CREATE TABLE `allowlist_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` integer NOT NULL,
	`list_type` text NOT NULL,
	`value` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `allowlist_bot_type_value_idx` ON `allowlist_entries` (`bot_id`,`list_type`,`value`);--> statement-breakpoint
CREATE INDEX `allowlist_bot_type_idx` ON `allowlist_entries` (`bot_id`,`list_type`);--> statement-breakpoint
CREATE TABLE `bots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`telegram_bot_id` integer NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`avatar_url` text,
	`encrypted_token` text NOT NULL,
	`last_update_id` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bots_telegram_id_idx` ON `bots` (`telegram_bot_id`);--> statement-breakpoint
CREATE TABLE `broadcasts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`targets_json` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`run_at` integer NOT NULL,
	`dispatched_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `broadcasts_bot_run_idx` ON `broadcasts` (`bot_id`,`status`,`run_at`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` integer NOT NULL,
	`telegram_chat_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`username` text,
	`avatar_url` text,
	`avatar_color` text,
	`avatar_text` text,
	`pinned` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`muted` integer DEFAULT false NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`last_message_text` text,
	`last_message_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chats_bot_telegram_idx` ON `chats` (`bot_id`,`telegram_chat_id`);--> statement-breakpoint
CREATE INDEX `chats_last_message_idx` ON `chats` (`bot_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_idx` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`telegram_message_id` integer,
	`direction` text NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`author_name` text,
	`author_telegram_id` integer,
	`text` text,
	`reply_to_message_id` integer,
	`media_r2_key` text,
	`media_mime_type` text,
	`reactions_json` text,
	`status` text,
	`failure_reason` text,
	`sent_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_bot_telegram_idx` ON `messages` (`bot_id`,`telegram_message_id`);--> statement-breakpoint
CREATE INDEX `messages_chat_sent_idx` ON `messages` (`chat_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` integer NOT NULL,
	`key` text NOT NULL,
	`tokens_x_1000` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limits_bot_key_idx` ON `rate_limits` (`bot_id`,`key`);