CREATE TABLE `sales_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`person` text NOT NULL,
	`month` text NOT NULL,
	`amount_tenge` integer NOT NULL,
	`paid_at` text NOT NULL,
	`note` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_payment_request` ON `sales_payments` (`actor_id`,`request_id`);
--> statement-breakpoint
CREATE INDEX `sales_payment_person_month` ON `sales_payments` (`person`,`month`,`paid_at`);
--> statement-breakpoint
CREATE TABLE `sales_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`person` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`metric` text NOT NULL,
	`target` integer NOT NULL,
	`base_rate` real NOT NULL,
	`target_rate` real NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_plan_request` ON `sales_plans` (`actor_id`,`request_id`);
--> statement-breakpoint
CREATE INDEX `sales_plan_person_dates` ON `sales_plans` (`person`,`start_date`,`end_date`);
