CREATE TABLE `assessment_upload_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`request_id` text NOT NULL,
	`identity_revision` integer NOT NULL,
	`manifest_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`actor_id` text NOT NULL,
	`authentication` text NOT NULL,
	`state` text NOT NULL,
	`receipt_json` text,
	`outcome_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `assessment_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_upload_request` ON `assessment_upload_manifests` (`case_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_upload_active` ON `assessment_upload_manifests` (`case_id`) WHERE "assessment_upload_manifests"."state" <> 'verified';