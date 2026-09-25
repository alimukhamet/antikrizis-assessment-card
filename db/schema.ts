import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const assessmentCases = sqliteTable('assessment_cases', {
  id:text('id').primaryKey(), externalSystem:text('external_system').notNull(), externalId:text('external_id').notNull(),
  clientIin:text('client_iin'), identityRevision:integer('identity_revision').notNull().default(1), title:text('title').notNull(),
  createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('assessment_case_external').on(t.externalSystem,t.externalId)]);
export const assessmentDocuments = sqliteTable('assessment_documents', {
  id:text('id').primaryKey(), caseId:text('case_id').notNull().references(()=>assessmentCases.id),
  originalSha256:text('original_sha256').notNull(), originalKey:text('original_key').notNull(), originalName:text('original_name').notNull(),
  byteSize:integer('byte_size').notNull(), uploadedBy:text('uploaded_by').notNull(), createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('assessment_document_content').on(t.caseId,t.originalSha256)]);
export const assessmentExtractions = sqliteTable('assessment_extractions', {
  id:text('id').primaryKey(), documentId:text('document_id').notNull().references(()=>assessmentDocuments.id),
  version:text('version').notNull(), resultKey:text('result_key').notNull(), resultSha256:text('result_sha256').notNull(), createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('assessment_extraction_version').on(t.documentId,t.version)]);
// One immutable, employee-confirmed document identity per case revision.
export const assessmentIdentityBindings=sqliteTable('assessment_identity_bindings',{
 id:text('id').primaryKey(),caseId:text('case_id').notNull().references(()=>assessmentCases.id),
 identityRevision:integer('identity_revision').notNull(),iin:text('iin').notNull(),
 documentId:text('document_id').notNull().references(()=>assessmentDocuments.id),
 extractionId:text('extraction_id').notNull().references(()=>assessmentExtractions.id),
 actorId:text('actor_id').notNull(),authentication:text('authentication').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('assessment_identity_binding_revision').on(t.caseId,t.identityRevision)]);
export const assessmentReviews = sqliteTable('assessment_reviews', {
  id:text('id').primaryKey(), requestId:text('request_id').notNull(), caseId:text('case_id').notNull().references(()=>assessmentCases.id),
  documentId:text('document_id').notNull().references(()=>assessmentDocuments.id), extractionId:text('extraction_id').notNull().references(()=>assessmentExtractions.id),
  identityRevision:integer('identity_revision').notNull(), factKey:text('fact_key').notNull(), valueJson:text('value_json').notNull(),
  disposition:text('disposition').notNull(), reason:text('reason').notNull(), actorId:text('actor_id').notNull(), authentication:text('authentication').notNull(),
  payloadHash:text('payload_hash').notNull(), createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('assessment_review_request').on(t.caseId,t.requestId),index('assessment_review_lookup').on(t.documentId,t.factKey,t.createdAt)]);
export const questionnaireDrafts = sqliteTable('assessment_draft_versions', {
 id:text('id').primaryKey(),caseId:text('case_id').notNull().references(()=>assessmentCases.id),
 revision:integer('revision').notNull(),identityRevision:integer('identity_revision').notNull(),
 requestId:text('request_id').notNull(),payloadJson:text('payload_json').notNull(),payloadHash:text('payload_hash').notNull(),
 actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('assessment_draft_revision').on(t.caseId,t.revision),uniqueIndex('assessment_draft_request').on(t.caseId,t.requestId)]);
export const assessmentSubmissions = sqliteTable('assessment_submissions', {
 id:text('id').primaryKey(),caseId:text('case_id').notNull().references(()=>assessmentCases.id),
 requestId:text('request_id').notNull(),identityRevision:integer('identity_revision').notNull(),
 payloadJson:text('payload_json').notNull(),payloadHash:text('payload_hash').notNull(),
 actorId:text('actor_id').notNull(),authentication:text('authentication').notNull(),
 state:text('state').notNull(),outcomeCode:text('outcome_code'),
 historyState:text('history_state').notNull().default('pending'),historyCommentId:text('history_comment_id'),historyOutcomeCode:text('history_outcome_code'),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('assessment_submission_request').on(t.caseId,t.requestId),
 uniqueIndex('assessment_submission_active').on(t.caseId).where(sql`${t.state} NOT IN ('verified', 'cancelled')`)]);
export const loginAttempts=sqliteTable('assessment_login_attempts',{
 key:text('key').primaryKey(),attempts:integer('attempts').notNull(),expiresAt:integer('expires_at').notNull(),
},t=>[index('assessment_login_expiry').on(t.expiresAt)]);
export const uploadManifests=sqliteTable('assessment_upload_manifests',{
 id:text('id').primaryKey(),caseId:text('case_id').notNull().references(()=>assessmentCases.id),requestId:text('request_id').notNull(),
 identityRevision:integer('identity_revision').notNull(),manifestJson:text('manifest_json').notNull(),payloadHash:text('payload_hash').notNull(),
 actorId:text('actor_id').notNull(),authentication:text('authentication').notNull(),state:text('state').notNull(),
 receiptJson:text('receipt_json'),outcomeCode:text('outcome_code'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('assessment_upload_request').on(t.caseId,t.requestId),uniqueIndex('assessment_upload_active').on(t.caseId).where(sql`${t.state} NOT IN ('verified','cancelled')`)]);
export const toolFeedback=sqliteTable('assessment_tool_feedback',{
 id:text('id').primaryKey(),requestId:text('request_id').notNull(),schemaVersion:integer('schema_version').notNull(),
 actorId:text('actor_id').notNull(),actorName:text('actor_name').notNull(),authentication:text('authentication').notNull(),
 dealId:text('deal_id'),step:text('step').notNull(),fieldId:text('field_id'),fieldLabel:text('field_label'),
 message:text('message').notNull(),clientVersion:text('client_version').notNull(),serverVersion:text('server_version').notNull(),
 payloadJson:text('payload_json').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('assessment_feedback_request').on(t.actorId,t.requestId),index('assessment_feedback_actor_time').on(t.actorId,t.createdAt)]);
export const lawyerHandoffs=sqliteTable('assessment_handoffs',{
 id:text('id').primaryKey(),caseId:text('case_id').notNull().references(()=>assessmentCases.id),
 requestId:text('request_id').notNull(),identityRevision:integer('identity_revision').notNull(),
 actorId:text('actor_id').notNull(),authentication:text('authentication').notNull(),
 payloadJson:text('payload_json').notNull(),payloadHash:text('payload_hash').notNull(),
 state:text('state').notNull(),outcomeCode:text('outcome_code'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('assessment_handoff_request').on(t.caseId,t.requestId),uniqueIndex('assessment_handoff_once').on(t.caseId).where(sql`${t.state} <> 'cancelled'`)]);
// One row per documentologist profile save. `payload_json` keeps the Bitrix baseline
// read before the write, so any profile save can be reverted from here.
export const profileSaves=sqliteTable('assessment_profile_saves',{
 id:text('id').primaryKey(),caseId:text('case_id').notNull().references(()=>assessmentCases.id),
 requestId:text('request_id').notNull(),identityRevision:integer('identity_revision').notNull(),
 actorId:text('actor_id').notNull(),authentication:text('authentication').notNull(),
 payloadJson:text('payload_json').notNull(),payloadHash:text('payload_hash').notNull(),
 state:text('state').notNull(),outcomeCode:text('outcome_code'),historyCommentId:text('history_comment_id'),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('assessment_profile_save_request').on(t.caseId,t.requestId),
 uniqueIndex('assessment_profile_save_active').on(t.caseId).where(sql`${t.state} IN ('writing','uncertain')`)]);
