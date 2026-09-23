CREATE TABLE assessment_draft_recoveries (
 case_id text PRIMARY KEY NOT NULL REFERENCES assessment_cases(id),
 request_id text NOT NULL UNIQUE,
 identity_revision integer NOT NULL,
 source_hash text NOT NULL,
 plan_json text NOT NULL,
 plan_hash text NOT NULL,
 actor_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('prepared','writing','uncertain','verified','cancelled')),
 created_at text NOT NULL,
 updated_at text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER recovery_blocks_submission BEFORE INSERT ON assessment_submissions
WHEN EXISTS (SELECT 1 FROM assessment_draft_recoveries WHERE case_id=NEW.case_id AND state IN ('prepared','writing','uncertain'))
BEGIN SELECT RAISE(ABORT,'DRAFT_RECOVERY_PENDING'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_blocks_draft BEFORE INSERT ON assessment_draft_versions
WHEN EXISTS (SELECT 1 FROM assessment_draft_recoveries WHERE case_id=NEW.case_id AND state IN ('prepared','writing','uncertain'))
BEGIN SELECT RAISE(ABORT,'DRAFT_RECOVERY_PENDING'); END;
