CREATE TABLE `assessment_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`external_system` text NOT NULL,
	`external_id` text NOT NULL,
	`client_iin` text,
	`identity_revision` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_case_external` ON `assessment_cases` (`external_system`,`external_id`);--> statement-breakpoint
CREATE TABLE `assessment_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`original_sha256` text NOT NULL,
	`original_key` text NOT NULL,
	`original_name` text NOT NULL,
	`byte_size` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `assessment_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_document_content` ON `assessment_documents` (`case_id`,`original_sha256`);--> statement-breakpoint
CREATE TABLE `assessment_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`version` text NOT NULL,
	`result_key` text NOT NULL,
	`result_sha256` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `assessment_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_extraction_version` ON `assessment_extractions` (`document_id`,`version`);--> statement-breakpoint
CREATE TABLE `assessment_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`case_id` text NOT NULL,
	`document_id` text NOT NULL,
	`extraction_id` text NOT NULL,
	`identity_revision` integer NOT NULL,
	`fact_key` text NOT NULL,
	`value_json` text NOT NULL,
	`disposition` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`authentication` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `assessment_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `assessment_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`extraction_id`) REFERENCES `assessment_extractions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_review_request` ON `assessment_reviews` (`case_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `assessment_review_lookup` ON `assessment_reviews` (`document_id`,`fact_key`,`created_at`);