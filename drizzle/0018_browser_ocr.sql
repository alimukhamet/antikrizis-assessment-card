-- OCR is unverified assistance. Native extractions, reviews and drafts stay immutable.
CREATE TABLE assessment_browser_ocr_leases (
 document_id text PRIMARY KEY NOT NULL REFERENCES assessment_documents(id),
 case_id text NOT NULL REFERENCES assessment_cases(id),
 original_sha256 text NOT NULL,
 engine_version text NOT NULL,
 identity_revision integer NOT NULL,
 token_hash text NOT NULL,
 actor_id text NOT NULL,
 actor_name text NOT NULL,
 expires_at integer NOT NULL,
 updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE assessment_browser_ocr_pages (
 case_id text NOT NULL REFERENCES assessment_cases(id),
 document_id text NOT NULL REFERENCES assessment_documents(id),
 original_sha256 text NOT NULL,
 engine_version text NOT NULL,
 identity_revision integer NOT NULL,
 page_number integer NOT NULL CHECK (page_number > 0),
 result_json text NOT NULL,
 result_sha256 text NOT NULL,
 result_bytes integer NOT NULL,
 character_count integer NOT NULL,
 confidence real NOT NULL,
 state text NOT NULL CHECK (state IN ('completed','needs_manual')),
 actor_id text NOT NULL,
 token_hash text NOT NULL,
 created_at integer NOT NULL,
 PRIMARY KEY (case_id,document_id,original_sha256,engine_version,identity_revision,page_number)
);
