CREATE TABLE `assessment_profile_saves` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`request_id` text NOT NULL,
	`identity_revision` integer NOT NULL,
	`actor_id` text NOT NULL,
	`authentication` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`state` text NOT NULL,
	`outcome_code` text,
	`history_comment_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `assessment_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_profile_save_request` ON `assessment_profile_saves` (`case_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_profile_save_active` ON `assessment_profile_saves` (`case_id`) WHERE "assessment_profile_saves"."state" IN ('writing','uncertain');