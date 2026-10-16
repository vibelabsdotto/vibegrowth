CREATE TABLE `feature_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`featurama_project_id` text NOT NULL,
	`request_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` text,
	`votes` integer DEFAULT 0 NOT NULL,
	`approved` integer DEFAULT false NOT NULL,
	`platform` text,
	`app_version` text,
	`requested_at` text,
	`last_user_comment_at` text,
	`last_developer_comment_at` text,
	`needs_reply` integer DEFAULT false NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`comments` text DEFAULT '[]' NOT NULL,
	`url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_requests_project_request` ON `feature_requests` (`project_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `feature_requests_project_needs_reply` ON `feature_requests` (`project_id`,`needs_reply`);--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`summary` text,
	`guide` text,
	`status` text DEFAULT 'active' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`source` text,
	`actor` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `strategies_project_category` ON `strategies` (`project_id`,`category`);--> statement-breakpoint
ALTER TABLE `approvals` ADD `category` text;--> statement-breakpoint
ALTER TABLE `backlog_items` ADD `category` text;--> statement-breakpoint
ALTER TABLE `backlog_items` ADD `notion_url` text;--> statement-breakpoint
ALTER TABLE `changes` ADD `category` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `category` text;--> statement-breakpoint
ALTER TABLE `decisions` ADD `category` text;--> statement-breakpoint
ALTER TABLE `experiments` ADD `category` text;--> statement-breakpoint
ALTER TABLE `learnings` ADD `category` text;--> statement-breakpoint
ALTER TABLE `store_reviews` ADD `last_modified` text;--> statement-breakpoint
ALTER TABLE `store_reviews` ADD `reply_at` text;--> statement-breakpoint
ALTER TABLE `store_reviews` ADD `reply_state` text;--> statement-breakpoint
ALTER TABLE `store_reviews` ADD `needs_reply` integer DEFAULT false NOT NULL;