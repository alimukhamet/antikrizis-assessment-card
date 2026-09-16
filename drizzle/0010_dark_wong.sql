CREATE TABLE `assessment_identity_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`identity_revision` integer NOT NULL,
	`iin` text NOT NULL,
	`document_id` text NOT NULL,
	`extraction_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`authentication` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `assessment_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `assessment_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`extraction_id`) REFERENCES `assessment_extractions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_identity_binding_revision` ON `assessment_identity_bindings` (`case_id`,`identity_revision`);