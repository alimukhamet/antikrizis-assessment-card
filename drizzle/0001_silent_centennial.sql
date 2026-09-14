CREATE TABLE `assessment_draft_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`revision` integer NOT NULL,
	`identity_revision` integer NOT NULL,
	`request_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `assessment_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_draft_revision` ON `assessment_draft_versions` (`case_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_draft_request` ON `assessment_draft_versions` (`case_id`,`request_id`);