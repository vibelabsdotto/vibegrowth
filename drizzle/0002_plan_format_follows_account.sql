-- A plan entry's format_id is now an explicit override of the account's active format.
-- Open agent entries only carried a copy of the account default; let them follow the account again.
-- Locked and Max entries stay untouched, produced entries keep the format they were made with.
INSERT INTO `history` (`actor`, `entity`, `entity_id`, `action`, `before`, `after`)
SELECT 'migration:0002', 'plan_entry', CAST(p.`id` AS TEXT), 'update',
  json_object('formatId', p.`format_id`), json_object('formatId', NULL)
FROM `plan_entries` p JOIN `accounts` a ON a.`id` = p.`account_id`
WHERE p.`status` IN ('idea', 'planned', 'in_production') AND p.`locked` = 0 AND p.`origin` = 'agent'
  AND p.`format_id` = a.`default_format_id`;--> statement-breakpoint
UPDATE `plan_entries` SET `format_id` = NULL, `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE `status` IN ('idea', 'planned', 'in_production') AND `locked` = 0 AND `origin` = 'agent'
  AND `format_id` = (SELECT a.`default_format_id` FROM `accounts` a WHERE a.`id` = `plan_entries`.`account_id`);
