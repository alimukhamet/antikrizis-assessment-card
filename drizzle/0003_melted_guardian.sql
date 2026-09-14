CREATE TABLE `assessment_login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assessment_login_expiry` ON `assessment_login_attempts` (`expires_at`);