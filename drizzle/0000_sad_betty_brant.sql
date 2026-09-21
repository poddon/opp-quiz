CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`player_id` text NOT NULL,
	`question_index` integer NOT NULL,
	`option_index` integer NOT NULL,
	`is_correct` integer NOT NULL,
	`points` integer NOT NULL,
	`score_applied` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_answers_player_question` ON `answers` (`player_id`,`question_index`);--> statement-breakpoint
CREATE INDEX `idx_answers_room_question` ON `answers` (`room_id`,`question_index`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_players_room_score` ON `players` (`room_id`,`score`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`current_question` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rooms_code` ON `rooms` (`code`);--> statement-breakpoint
CREATE TABLE `score_events` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`player_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_score_events_room_created` ON `score_events` (`room_id`,`created_at`);--> statement-breakpoint
PRAGMA optimize;
