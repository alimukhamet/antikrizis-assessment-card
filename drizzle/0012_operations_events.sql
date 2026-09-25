CREATE TABLE IF NOT EXISTS assessment_operations_events (
 id text PRIMARY KEY NOT NULL,
 actor_id text NOT NULL,
 deal_id text,
 action text NOT NULL,
 code text NOT NULL,
 client_version text NOT NULL,
 server_version text NOT NULL,
 status integer NOT NULL,
 asset text,
 line integer,
 created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assessment_operations_time ON assessment_operations_events(created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assessment_operations_actor_time ON assessment_operations_events(actor_id,created_at);
