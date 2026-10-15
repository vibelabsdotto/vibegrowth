-- Site-wide learnings imported from the website-growth README were stored as "global" and so showed up
-- in every shortform account context. They apply to growth work only: scope "growth".
INSERT INTO `history` (`actor`, `entity`, `entity_id`, `action`, `before`, `after`)
SELECT 'byte', 'learning', CAST(`id` AS TEXT), 'update', '{"scopeType":"global"}', '{"scopeType":"growth"}'
FROM `learnings` WHERE `scope_type` = 'global' AND `source` = 'Website-Growth README';
--> statement-breakpoint
UPDATE `learnings` SET `scope_type` = 'growth', `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE `scope_type` = 'global' AND `source` = 'Website-Growth README';
