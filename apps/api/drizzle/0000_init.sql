CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`handle` text,
	`platform` text DEFAULT 'tiktok' NOT NULL,
	`language` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`dir` text NOT NULL,
	`default_format_id` text,
	`mode` text,
	`cta_rule` text DEFAULT 'engagement' NOT NULL,
	`posts_per_day` integer DEFAULT 1 NOT NULL,
	`character_id` text,
	`notion_context_id` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notion_url` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand_id` text,
	`persona` text,
	`voice` text,
	`look` text,
	`dos` text,
	`donts` text,
	`reference_images` text DEFAULT '[]' NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `characters_source_key_unique` ON `characters` (`source_key`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'decision' NOT NULL,
	`title` text NOT NULL,
	`rationale` text NOT NULL,
	`date` text NOT NULL,
	`actor` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`supersedes_id` integer,
	`source` text,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_source_key_unique` ON `decisions` (`source_key`);--> statement-breakpoint
CREATE TABLE `format_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`format_id` text NOT NULL,
	`version` integer NOT NULL,
	`description` text,
	`slide_structure` text,
	`renderer_params` text DEFAULT '{}' NOT NULL,
	`change_note` text,
	`actor` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `format_versions_format_version` ON `format_versions` (`format_id`,`version`);--> statement-breakpoint
CREATE TABLE `formats` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`brand_id` text,
	`current_version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actor` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text
);
--> statement-breakpoint
CREATE INDEX `history_entity` ON `history` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `history_at` ON `history` (`at`);--> statement-breakpoint
CREATE TABLE `hooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`text` text NOT NULL,
	`mechanism` text,
	`origin_post_id` integer,
	`winner` integer DEFAULT false NOT NULL,
	`parent_id` integer,
	`actor` text NOT NULL,
	`source` text,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hooks_source_key_unique` ON `hooks` (`source_key`);--> statement-breakpoint
CREATE TABLE `image_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`detection` text,
	`countermeasure` text NOT NULL,
	`format_ids` text DEFAULT '[]' NOT NULL,
	`example_image` text,
	`source` text NOT NULL,
	`actor` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_errors_source_key_unique` ON `image_errors` (`source_key`);--> statement-breakpoint
CREATE TABLE `inspirations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`platform` text,
	`type` text DEFAULT 'format' NOT NULL,
	`note` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`brand_id` text,
	`account_id` text,
	`status` text DEFAULT 'new' NOT NULL,
	`files` text DEFAULT '[]' NOT NULL,
	`briefing_path` text,
	`actor` text NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspirations_url_unique` ON `inspirations` (`url`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspirations_source_key_unique` ON `inspirations` (`source_key`);--> statement-breakpoint
CREATE TABLE `learnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`statement` text NOT NULL,
	`evidence` text NOT NULL,
	`evidence_post_ids` text DEFAULT '[]' NOT NULL,
	`date` text NOT NULL,
	`actor` text NOT NULL,
	`source` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learnings_source_key_unique` ON `learnings` (`source_key`);--> statement-breakpoint
CREATE TABLE `metric_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`post_id` integer,
	`tiktok_id` text NOT NULL,
	`url` text,
	`live_since` text,
	`pulled_at` text NOT NULL,
	`age_h` real NOT NULL,
	`plays` integer DEFAULT 0 NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`saves` integer DEFAULT 0 NOT NULL,
	`comments` integer DEFAULT 0 NOT NULL,
	`shares` integer DEFAULT 0 NOT NULL,
	`reposts` integer DEFAULT 0 NOT NULL,
	`slides` integer,
	`description` text,
	`match_dist` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metric_snapshots_tiktok_pulled` ON `metric_snapshots` (`tiktok_id`,`pulled_at`);--> statement-breakpoint
CREATE INDEX `metric_snapshots_post` ON `metric_snapshots` (`post_id`);--> statement-breakpoint
CREATE TABLE `plan_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text,
	`account_id` text NOT NULL,
	`format_id` text,
	`topic` text NOT NULL,
	`angle` text,
	`hook_direction` text,
	`hook` text,
	`rationale` text,
	`origin` text DEFAULT 'agent' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`inspiration_id` integer,
	`hook_id` integer,
	`comment` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspiration_id`) REFERENCES `inspirations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hook_id`) REFERENCES `hooks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_entries_source_key_unique` ON `plan_entries` (`source_key`);--> statement-breakpoint
CREATE INDEX `plan_entries_account_date` ON `plan_entries` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`plan_entry_id` integer,
	`dir` text NOT NULL,
	`slug` text NOT NULL,
	`date` text,
	`hook` text,
	`caption` text,
	`angle` text,
	`slide_count` integer,
	`slides` text DEFAULT '[]' NOT NULL,
	`contact_sheet` text,
	`mp4` text,
	`zip` text,
	`delivered_at` text,
	`tiktok_id` text,
	`tiktok_url` text,
	`posted_at` text,
	`status` text DEFAULT 'produced' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_entry_id`) REFERENCES `plan_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_dir_unique` ON `posts` (`dir`);--> statement-breakpoint
CREATE UNIQUE INDEX `posts_tiktok_id_unique` ON `posts` (`tiktok_id`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`format_version` integer,
	`kind` text DEFAULT 'other' NOT NULL,
	`text` text NOT NULL,
	`source` text NOT NULL,
	`actor` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`replaced_by` integer,
	`date` text NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rules_source_key_unique` ON `rules` (`source_key`);--> statement-breakpoint
CREATE INDEX `rules_scope` ON `rules` (`scope_type`,`scope_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
