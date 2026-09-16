CREATE TABLE `device_views_daily` (
	`day` text NOT NULL,
	`device_type` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `device_type`)
);
