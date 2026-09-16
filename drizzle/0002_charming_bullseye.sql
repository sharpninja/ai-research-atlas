CREATE TABLE `analytics_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `page_views_daily` (
	`day` text NOT NULL,
	`path` text NOT NULL,
	`referrer` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `path`, `referrer`)
);
