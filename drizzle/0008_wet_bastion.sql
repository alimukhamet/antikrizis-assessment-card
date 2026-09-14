CREATE TABLE `assessment_tool_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`schema_version` integer NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`authentication` text NOT NULL,
	`deal_id` text,
	`step` text NOT NULL,
	`field_id` text,
	`field_label` text,
	`message` text NOT NULL,
	`client_version` text NOT NULL,
	`server_version` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_feedback_request` ON `assessment_tool_feedback` (`actor_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `assessment_feedback_actor_time` ON `assessment_tool_feedback` (`actor_id`,`created_at`);