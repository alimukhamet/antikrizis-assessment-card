ALTER TABLE `assessment_submissions` ADD `history_state` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `assessment_submissions` ADD `history_comment_id` text;--> statement-breakpoint
ALTER TABLE `assessment_submissions` ADD `history_outcome_code` text;