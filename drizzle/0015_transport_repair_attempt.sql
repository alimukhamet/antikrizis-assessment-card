-- Separate forensic record: preserve the unresolved upload and its exclusive
-- active-upload index until actual file-byte readback resolves it.
CREATE TABLE assessment_transport_repairs (
 case_id text PRIMARY KEY NOT NULL REFERENCES assessment_cases(id),
 request_id text NOT NULL UNIQUE,
 original_request_id text NOT NULL,
 original_payload_hash text NOT NULL,
 identity_revision integer NOT NULL,
 actor_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('prepared','writing','uncertain','verified')),
 receipt_json text,
 outcome_code text,
 created_at text NOT NULL,
 updated_at text NOT NULL
);
