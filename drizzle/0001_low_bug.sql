CREATE TABLE `submission_events` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `timeline_submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_submission_events_submission` ON `submission_events` (`submission_id`);--> statement-breakpoint
CREATE TABLE `timeline_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	`submission_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_submissions_author_created` ON `timeline_submissions` (`author_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_submissions_status_created` ON `timeline_submissions` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_submissions_author_key` ON `timeline_submissions` (`author_id`,`submission_key`);