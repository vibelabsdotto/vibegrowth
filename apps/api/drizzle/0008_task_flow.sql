CREATE TABLE `task_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`backlog_item_id` integer NOT NULL,
	`kind` text DEFAULT 'comment' NOT NULL,
	`body` text NOT NULL,
	`attachments` text,
	`actor` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`backlog_item_id`) REFERENCES `backlog_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_comments_item` ON `task_comments` (`backlog_item_id`);--> statement-breakpoint
ALTER TABLE `backlog_items` ADD `assignee` text;--> statement-breakpoint
ALTER TABLE `backlog_items` ADD `sources` text;--> statement-breakpoint
ALTER TABLE `backlog_items` ADD `accepted_at` text;--> statement-breakpoint
ALTER TABLE `backlog_items` ADD `released_version` text;--> statement-breakpoint
ALTER TABLE `backlog_items` ADD `released_at` text;