ALTER TABLE `format_versions` RENAME COLUMN "slide_structure" TO "guide";--> statement-breakpoint
ALTER TABLE `format_versions` ADD `skills` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `format_versions` ADD `examples` text DEFAULT '[]' NOT NULL;