-- Short-lived presence only; opening a profile does not change client answers.
CREATE TABLE assessment_profile_presence (
 id text PRIMARY KEY NOT NULL,
 deal_id text NOT NULL,
 actor_id text NOT NULL,
 updated_at text NOT NULL,
 expires_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX assessment_profile_presence_expiry ON assessment_profile_presence (expires_at);
