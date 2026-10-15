-- Hand edited: drizzle-kit wanted to rebuild accounts, characters, formats and inspirations
-- because their foreign keys now point to projects. ALTER TABLE RENAME already rewrites those
-- references in SQLite, so the rebuilds are dropped (no data copy, no FK risk).
ALTER TABLE `brands` RENAME TO `projects`;--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`account_id` text,
	`kind` text DEFAULT 'other' NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`decision_note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `approvals_project_status` ON `approvals` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `approvals_status` ON `approvals` (`status`);--> statement-breakpoint
CREATE INDEX `approvals_ref` ON `approvals` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `audit_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `audit_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_issues_run` ON `audit_issues` (`run_id`);--> statement-breakpoint
CREATE INDEX `audit_issues_project` ON `audit_issues` (`project_id`);--> statement-breakpoint
CREATE TABLE `audit_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `audit_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_pages_run_url` ON `audit_pages` (`run_id`,`url`);--> statement-breakpoint
CREATE INDEX `audit_pages_project` ON `audit_pages` (`project_id`);--> statement-breakpoint
CREATE TABLE `audit_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`at` text NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`ok` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_runs_project_at` ON `audit_runs` (`project_id`,`at`);--> statement-breakpoint
CREATE TABLE `backlog_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`kind` text DEFAULT 'other' NOT NULL,
	`impact` integer DEFAULT 2 NOT NULL,
	`effort` integer DEFAULT 2 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`source` text,
	`done_ref` text,
	`position` integer DEFAULT 0 NOT NULL,
	`actor` text NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backlog_items_source_key_unique` ON `backlog_items` (`source_key`);--> statement-breakpoint
CREATE INDEX `backlog_items_project_status` ON `backlog_items` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text,
	`date` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`summary` text NOT NULL,
	`ref` text,
	`experiment_id` integer,
	`actor` text NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `changes_source_key_unique` ON `changes` (`source_key`);--> statement-breakpoint
CREATE INDEX `changes_project_date` ON `changes` (`project_id`,`date`);--> statement-breakpoint
CREATE INDEX `changes_experiment` ON `changes` (`experiment_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`url` text,
	`handle` text,
	`external_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `channels_project` ON `channels` (`project_id`);--> statement-breakpoint
CREATE TABLE `collector_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`collector` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`ok` integer,
	`summary` text,
	`error` text,
	`stats` text DEFAULT '{}' NOT NULL,
	`actor` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collector_runs_project_collector` ON `collector_runs` (`project_id`,`collector`,`started_at`);--> statement-breakpoint
CREATE INDEX `collector_runs_started` ON `collector_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `collectors` (
	`project_id` text NOT NULL,
	`collector` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`project_id`, `collector`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text,
	`kind` text DEFAULT 'blog' NOT NULL,
	`title` text NOT NULL,
	`keyword` text,
	`intent` text,
	`brief` text,
	`status` text DEFAULT 'idea' NOT NULL,
	`draft_path` text,
	`url_path` text,
	`live_date` text,
	`approval_id` integer,
	`notes` text,
	`position` integer DEFAULT 0 NOT NULL,
	`actor` text NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_id`) REFERENCES `approvals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_items_source_key_unique` ON `content_items` (`source_key`);--> statement-breakpoint
CREATE INDEX `content_items_project_status` ON `content_items` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text,
	`title` text NOT NULL,
	`hypothesis` text,
	`target_type` text DEFAULT 'page' NOT NULL,
	`target` text,
	`metric` text NOT NULL,
	`start_date` text NOT NULL,
	`baseline_days` integer DEFAULT 28 NOT NULL,
	`eval_days` integer DEFAULT 28 NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`result` text,
	`verdict` text,
	`actor` text NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_source_key_unique` ON `experiments` (`source_key`);--> statement-breakpoint
CREATE INDEX `experiments_project_status` ON `experiments` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `experiments_start` ON `experiments` (`start_date`);--> statement-breakpoint
CREATE TABLE `geo_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`question_id` integer NOT NULL,
	`date` text NOT NULL,
	`engine` text NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`mentioned` integer DEFAULT false NOT NULL,
	`position` integer,
	`cited` integer DEFAULT false NOT NULL,
	`in_sources` integer DEFAULT false NOT NULL,
	`brands` text DEFAULT '[]' NOT NULL,
	`competitors` text DEFAULT '[]' NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`cited_urls` text DEFAULT '[]' NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`answer` text,
	`model` text,
	`evidence` text,
	`meta` text DEFAULT '{}' NOT NULL,
	`error` text,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `geo_questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `geo_checks_source_key_unique` ON `geo_checks` (`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `geo_checks_project_question_date_engine` ON `geo_checks` (`project_id`,`question_id`,`date`,`engine`);--> statement-breakpoint
CREATE INDEX `geo_checks_project_date` ON `geo_checks` (`project_id`,`date`);--> statement-breakpoint
CREATE TABLE `geo_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`text` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`source_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `geo_questions_source_key_unique` ON `geo_questions` (`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `geo_questions_project_text` ON `geo_questions` (`project_id`,`text`);--> statement-breakpoint
CREATE TABLE `kpi_daily` (
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`metric` text NOT NULL,
	`dims` text DEFAULT '' NOT NULL,
	`value` real NOT NULL,
	`channel_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`project_id`, `source`, `date`, `metric`, `dims`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kpi_daily_project_date` ON `kpi_daily` (`project_id`,`date`);--> statement-breakpoint
CREATE INDEX `kpi_daily_project_metric` ON `kpi_daily` (`project_id`,`source`,`metric`,`date`);--> statement-breakpoint
CREATE TABLE `mention_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`url` text,
	`kind` text DEFAULT 'other' NOT NULL,
	`seen_count` integer DEFAULT 0 NOT NULL,
	`cited_count` integer DEFAULT 0 NOT NULL,
	`first_seen` text,
	`last_seen` text,
	`status` text DEFAULT 'new' NOT NULL,
	`contact` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mention_targets_project_domain` ON `mention_targets` (`project_id`,`domain`);--> statement-breakpoint
CREATE TABLE `search_daily` (
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`query` text NOT NULL,
	`page` text DEFAULT '' NOT NULL,
	`clicks` real DEFAULT 0 NOT NULL,
	`impressions` real DEFAULT 0 NOT NULL,
	`ctr` real DEFAULT 0 NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`project_id`, `source`, `date`, `query`, `page`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `search_daily_project_date` ON `search_daily` (`project_id`,`date`);--> statement-breakpoint
CREATE INDEX `search_daily_project_page` ON `search_daily` (`project_id`,`page`);--> statement-breakpoint
CREATE TABLE `store_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`store` text NOT NULL,
	`review_id` text NOT NULL,
	`date` text,
	`rating` integer,
	`title` text,
	`body` text,
	`language` text,
	`version` text,
	`reply` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_reviews_project_store_review` ON `store_reviews` (`project_id`,`store`,`review_id`);--> statement-breakpoint
CREATE INDEX `store_reviews_project_date` ON `store_reviews` (`project_id`,`date`);--> statement-breakpoint
ALTER TABLE `projects` ADD `url` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `kind` text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `language` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `repo` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `workspace` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `config` text DEFAULT '{}' NOT NULL;
