CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`entry` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`moderated_at` integer,
	`moderated_by` text,
	`submission_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_comments_entry_status_created` ON `comments` (`entry`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_comments_author_created` ON `comments` (`author_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_comments_status_created` ON `comments` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_comments_author_submission` ON `comments` (`author_id`,`submission_key`);--> statement-breakpoint
CREATE TABLE `moderation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_moderation_events_comment` ON `moderation_events` (`comment_id`);