ALTER TABLE `audit_runs` ADD `source_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `audit_runs_source_key_unique` ON `audit_runs` (`source_key`);--> statement-breakpoint
ALTER TABLE `collector_runs` ADD `source_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `collector_runs_source_key_unique` ON `collector_runs` (`source_key`);