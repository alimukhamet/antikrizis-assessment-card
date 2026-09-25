/**
 * Focused tests for the profile-collection capability:
 * new questionnaire keys, profile-only validation, the save-without-contract
 * persistence, its signed export/push, and that the contract lane is untouched.
 * All values are synthetic fixtures.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {createHash, webcrypto} from 'node:crypto';
import * as participants from '../public/loan-participants.mjs';
import * as schedule from '../public/payment-schedule.mjs';

function load(relative, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + relative, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
  }).outputText, {
    exports,
    require: name => imports[name],
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Map,
    Set,
    Date,
    JSON,
    Object,
    Math,
    Number,
    String,
    RegExp,
    Error,
    TypeError,
    Promise,
    Intl,
    Request,
    Response,
    Headers,
    URL,
    ReadableStream,
    AbortController,
    setTimeout,
    clearTimeout,
    atob,
    btoa,
  });
  return exports;
}

const json = relative => JSON.parse(fs.readFileSync(new URL('../' + relative, import.meta.url), 'utf8'));
const schema = json('lib/questionnaire/schema.json');
const repository = load('lib/documents/repository.ts');
const draft = load('lib/questionnaire/draft.ts', {
  './schema.json': schema,
  './draft-recovery': load('lib/questionnaire/draft-recovery.ts'),
  '../documents/repository': repository,
});
const profileAnswers = load('lib/questionnaire/profile-answers.ts', {'../documents/repository': repository});
const submissionRepository = load('lib/questionnaire/submission-repository.ts', {'../documents/repository': repository});
const profileSubmission = load('lib/questionnaire/profile-submission.ts', {
  '../documents/repository': repository,
  './draft': draft,
  './profile-answers': profileAnswers,
  './review-bindings': {parseReviewBindings: () => []},
  './submission-repository': submissionRepository,
});
const intakeExport = load('lib/crm/assessment-intake-export.ts');
const intakeAuth = load('lib/crm/assessment-intake-auth.ts', {'./assessment-intake-export': intakeExport});
const intakeSync = load('lib/crm/assessment-intake-sync.ts', {
  './assessment-intake-export': intakeExport,
  './assessment-intake-auth': intakeAuth,
});

const iin = '000000000010';
const dealId = '11665';
const actor = {id: 'worker:ramazan', authentication: 'session'};

function profileDraft(overrides = {}) {
  const defaults = [
    {key: 'fio', value: 'SYNTHETIC CLIENT', checked: false},
    {key: 'iin', value: iin, checked: false},
    {key: 'addressRegistration', value: 'SYNTHETIC REGISTRATION', checked: false},
    {key: 'addressActual', value: 'SYNTHETIC ACTUAL', checked: false},
    {key: 'enforcementStatus', value: 'no', checked: false},
  ];
  const byKey = new Map(defaults.map(answer => [answer.key, answer]));
  for (const answer of overrides.answers ?? []) byKey.set(answer.key, answer);
  return {
    schemaVersion: 1,
    answers: [...byKey.values()],
    groups: overrides.groups ?? [],
    docContext: {social: '', salary: ''},
    documents: [],
    pendingFiles: [],
  };
}

// --- questionnaire schema ---------------------------------------------------------------

test('the questionnaire exposes the profile keys behind the additive, non-blocking section', () => {
  const keys = new Set(schema.scalar.map(field => field.key));
  for (const key of ['addressRegistration', 'addressActual', 'addressActualSame', 'enforcementStatus', 'riskNotes']) {
    assert.ok(keys.has(key), `missing scalar ${key}`);
  }
  for (const key of ['addressRegistration', 'addressActual', 'enforcementStatus', 'riskNotes']) {
    assert.equal(schema.scalar.find(field => field.key === key).required, false, `${key} must not gate the contract`);
  }
  const enforcements = schema.groups.find(group => group.id === 'enforcements');
  assert.deepEqual(enforcements.conditions, ['enforcementRecords']);
  assert.equal(enforcements.profileOnly, true);
  assert.deepEqual(enforcements.fields.map(field => field.key), ['enforcementCreditor', 'enforcementAmount', 'enforcementNote']);
  assert.ok(enforcements.fields.every(field => field.required === false));
});

// --- profile-only validation ------------------------------------------------------------

test('profile readiness requires identity and both addresses and an explicit enforcement decision', () => {
  const empty = profileAnswers.checkProfileAnswers(draft.validateDraft({
    schemaVersion: 1, answers: [], groups: [], docContext: {social: '', salary: ''}, documents: [], pendingFiles: [],
  }), iin);
  assert.equal(empty.ready, false);
  for (const key of ['fio', 'addressRegistration', 'addressActual', 'enforcementStatus']) {
    assert.ok(empty.issues.some(issue => issue.key === key), `expected ${key}`);
  }
  const ready = profileAnswers.checkProfileAnswers(draft.validateDraft(profileDraft()), iin);
  assert.equal(ready.ready, true, JSON.stringify(ready.issues));
});

test('a positive enforcement answer requires structured numbers, not free text', () => {
  const yes = profileAnswers.checkProfileAnswers(draft.validateDraft(profileDraft({
    answers: [{key: 'enforcementStatus', value: 'yes', checked: false}],
  })), iin);
  assert.equal(yes.ready, false);
  assert.ok(yes.issues.some(issue => issue.key === 'enforcements'));

  const invalid = profileAnswers.checkProfileAnswers(draft.validateDraft(profileDraft({
    answers: [{key: 'enforcementStatus', value: 'yes', checked: false}],
    groups: [{id: 'enforcements', rows: [[{key: 'enforcementCreditor', value: 'SYNTHETIC CREDITOR', checked: false}, {key: 'enforcementAmount', value: 'not-a-number', checked: false}]], rowKeys: [null]}],
  })), iin);
  assert.ok(invalid.issues.some(issue => issue.key === 'enforcementAmount'));

  const complete = profileAnswers.checkProfileAnswers(draft.validateDraft(profileDraft({
    answers: [{key: 'enforcementStatus', value: 'yes', checked: false}],
    groups: [{id: 'enforcements', rows: [[{key: 'enforcementCreditor', value: 'SYNTHETIC CREDITOR', checked: false}, {key: 'enforcementAmount', value: '1000.50', checked: false}, {key: 'enforcementNote', value: 'SYNTHETIC NOTE', checked: false}]], rowKeys: [null]}],
  })), iin);
  assert.equal(complete.ready, true, JSON.stringify(complete.issues));
  assert.equal(complete.enforcementRowCount, 1);
});

test('the contract lane is unaffected by a positive enforcement decision with no rows', () => {
  const native = load('lib/documents/extract-native.ts', {
    './power-of-attorney': load('lib/documents/power-of-attorney.ts'),
    './kz-labels.json': json('lib/documents/kz-labels.json'),
  });
  const {checkAnswers} = load('lib/questionnaire/check-answers.ts', {
    './schema.json': schema,
    '../documents/extract-native': native,
    '../../public/payment-schedule.mjs': schedule,
    '../../public/loan-participants.mjs': participants,
  });
  const values = {
    fio: 'SYNTHETIC ONLY', enforcementDetails: 'Нет', guarantors: 'Нет', iin, dognum: 'TEST', marital: 'Холост / не замужем',
    dependents: '0', childrenTotal: '0', procedure: '199', 'count-clientjobs': '0', 'count-clientunofficial': '0',
    clientBenefitsCount: '0', c8037: '0', hardshipReason: 'Платежи вношу, трудностей нет', kaspiAnnual: '0',
    gamblingTransfers: 'no', lawyerNotesStatus: 'no', n8044: '0', summa: '500000', contractDate: '2026-09-10',
    months: '5', payDay: '7', grafType: '423', enforcementStatus: 'yes',
  };
  const credit = {n8038: 'TEST BANK', loanContractId: 'TEST-001', n8038Start: '2025-01', n8039: 'Потребительский кредит', loanStatus: 'Платится по графику', n8040: '100.25', n8041: '20.00', n8042: '0', n8043: 'Жильё', loanParticipants: 'Нет'};
  const payload = {
    schemaVersion: 1,
    answers: schema.scalar.map(field => ({key: field.key, value: values[field.key] || '', checked: ['choice:socialStatus:Нет', 'holding:client:none', 'choice:debtPurpose:Жильё'].includes(field.key)})),
    groups: schema.groups.map(group => ({id: group.id, rows: group.id === 'creditors' ? [group.fields.map(field => ({key: field.key, value: credit[field.key] || '', checked: false}))] : [], rowKeys: group.id === 'creditors' ? [null] : []})),
    docContext: {social: '0', salary: '0'}, documents: [], pendingFiles: [],
  };
  const result = checkAnswers(draft.validateDraft(payload), iin);
  assert.equal(result.answersComplete, true, JSON.stringify(result.issues));
});

// --- persistence ------------------------------------------------------------------------

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  sql.exec("INSERT INTO assessment_cases VALUES ('case-1','bitrix','11665',NULL,1,'SYNTHETIC','2026-09-10','2026-09-10')");
  const db = {
    prepare(query) {
      return {
        bind(...args) {
          const statement = sql.prepare(query);
          return {
            async first() { return statement.get(...args) ?? null; },
            async run() { statement.run(...args); return {success: true}; },
            async all() { return {results: statement.all(...args)}; },
          };
        },
      };
    },
  };
  return {db, sql};
}

const record = {id: 'case-1', external_system: 'bitrix', external_id: dealId, client_iin: iin, identity_revision: 1, title: 'SYNTHETIC', created_at: '', updated_at: ''};
const uuid = () => webcrypto.randomUUID();

test('save-without-contract persists a verified profile row, idempotently and without contract data', async () => {
  const {db, sql} = database();
  const repo = new submissionRepository.SubmissionRepository(db);
  const requestId = uuid();
  const row = await profileSubmission.prepareProfileSubmission(repo, record, actor, requestId, 1, profileDraft(), [], '2026-09-20');
  assert.equal(row.kind, 'profile');
  assert.equal(row.state, 'verified');
  assert.equal(row.outcome_code, 'PROFILE_SAVED_NO_CONTRACT');
  const payload = JSON.parse(row.payload_json);
  assert.equal(payload.profileOnly, true);
  assert.equal(payload.contractData, undefined);

  const retry = await profileSubmission.prepareProfileSubmission(repo, record, actor, requestId, 1, profileDraft(), [], '2026-09-20');
  assert.equal(retry.id, row.id, 'same request id must not create a second profile row');
  const reloaded = await profileSubmission.prepareProfileSubmission(repo, record, actor, uuid(), 1, profileDraft(), [], '2026-09-20');
  assert.equal(reloaded.id, row.id, 'identical content must converge on one profile row');
  assert.equal(sql.prepare('SELECT count(*) n FROM assessment_submissions').get().n, 1);

  assert.equal(await repo.latest('case-1', actor.id), null, 'the contract lane must not see a profile row');
  assert.equal((await repo.latestProfile('case-1', actor.id)).id, row.id);
});

test('profile persistence fails closed on a changed client identity', async () => {
  const {db} = database();
  const repo = new submissionRepository.SubmissionRepository(db);
  await assert.rejects(
    () => profileSubmission.prepareProfileSubmission(repo, {...record, identity_revision: 2}, actor, uuid(), 1, profileDraft(), [], '2026-09-20'),
    /PROFILE_NOT_READY|CASE_IDENTITY_CHANGED/,
  );
  await assert.rejects(
    () => profileSubmission.prepareProfileSubmission(repo, record, actor, uuid(), 1, profileDraft({answers: [{key: 'addressActual', value: '', checked: false}, {key: 'addressRegistration', value: '', checked: false}]}), [], '2026-09-20'),
    /PROFILE_NOT_READY/,
  );
});

// --- signed export and push -------------------------------------------------------------

const secret = 'assessment-intake-source-secret-for-tests-32-bytes';
const profileRowPayload = {
  schemaVersion: 1,
  profileOnly: true,
  draft: profileDraft(),
  reviewIds: [],
  evidence: [],
  assessmentDay: '2026-09-20',
};
const payloadHash = value => createHash('sha256').update(JSON.stringify({payload: value, identityRevision: 1, actorId: actor.id})).digest('hex');
const profileRow = {id: 'profile-1', case_id: 'case-1', identity_revision: 1, state: 'verified', actor_id: actor.id, kind: 'profile', sequence: 9, payload: profileRowPayload, payload_hash: payloadHash(profileRowPayload)};
const contractPayload = {
  schemaVersion: 1,
  draft: profileDraft(),
  baseline: {source: 'assessment'},
  values: {explicit: {}},
  contractData: {reviewed: true},
  contractRendererVersion: 'test-contract',
  lawyerCard: 'narrative',
  reviewIds: [],
  evidence: [],
  validationVersion: 'test-validation',
  assessmentDay: '2026-09-20',
};
const contractRow = {id: 'contract-1', case_id: 'case-1', identity_revision: 1, state: 'verified', actor_id: actor.id, kind: 'contract', sequence: 4, payload: contractPayload, payload_hash: payloadHash(contractPayload)};
function bundle(submissions) {
  return {case: {id: 'case-1', external_system: 'bitrix', external_id: dealId, identity_revision: 1}, documents: [], submissions};
}

test('a profile snapshot converts through the signed export with its new answers and no evidence artifacts', async () => {
  const result = await intakeExport.assessmentIntakeFromExport(bundle([profileRow]), {sourceSubmissionId: 'profile-1', expectedDealId: dealId});
  assert.equal(result.unresolvedEvidence.length, 0);
  assert.equal(result.intake.evidence.length, 0);
  const answers = new Map(result.intake.answers.answers.map(answer => [answer.key, answer.value]));
  assert.equal(answers.get('addressRegistration'), 'SYNTHETIC REGISTRATION');
  assert.equal(answers.get('addressActual'), 'SYNTHETIC ACTUAL');
  assert.equal(answers.get('enforcementStatus'), 'no');
  assert.deepEqual(result.intake.answers.groups.find(group => group.id === 'enforcements'), undefined);
});

test('the pull selector never lets a profile snapshot displace the contract snapshot', () => {
  assert.equal(intakeExport.selectAssessmentSubmissionFromExport(bundle([contractRow, profileRow])).sourceSubmissionId, 'contract-1');
  assert.equal(intakeExport.selectAssessmentSubmissionFromExport(bundle([profileRow])).sourceSubmissionId, 'profile-1');
});

test('the profile is pushed through the existing signed CRM boundary without contract or artifact writes', async () => {
  const calls = [];
  const result = await intakeSync.syncAssessmentIntake({
    dealId,
    sourceSubmissionId: 'profile-1',
    repository: {
      async findCaseByExternal() { return record; },
      async exportCase() { return bundle([profileRow]); },
      async document() { throw new Error('a profile-only push must not read document bytes'); },
      async originalStream() { throw new Error('a profile-only push must not stream artifacts'); },
    },
    secret,
    crmOrigin: 'https://crm.example.test',
    sourceOrigin: 'https://assessment.example.test',
    fetcher: async (url, init = {}) => {
      const pathname = new URL(String(url)).pathname;
      calls.push(pathname);
      if (pathname.endsWith('/prepare')) return Response.json({assessmentIntakePrepare: {handoverId: 'handover-1', artifacts: []}});
      const final = JSON.parse(init.body);
      assert.equal(final.assessmentIntake.sourceSubmission.contractData, undefined);
      assert.equal(final.assessmentIntake.sourceSubmission.profileOnly, true);
      return Response.json({assessmentIntake: {duplicate: false}}, {status: 201});
    },
  });
  assert.equal(result.status, 'synced');
  assert.deepEqual(calls, ['/api/crm/handovers/assessment-intake/prepare', '/api/crm/handovers/assessment-intake']);
});

test('a failed CRM prepare leaves the profile durable and never finalizes', async () => {
  const calls = [];
  const result = await intakeSync.syncAssessmentIntake({
    dealId,
    sourceSubmissionId: 'profile-1',
    repository: {
      async findCaseByExternal() { return record; },
      async exportCase() { return bundle([profileRow]); },
      async document() { throw new Error('unexpected'); },
      async originalStream() { throw new Error('unexpected'); },
    },
    secret,
    crmOrigin: 'https://crm.example.test',
    sourceOrigin: 'https://assessment.example.test',
    fetcher: async url => {
      calls.push(new URL(String(url)).pathname);
      return Response.json({error: 'assessment_intake_handover_missing'}, {status: 404});
    },
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'assessment_intake_handover_missing');
  assert.deepEqual(calls, ['/api/crm/handovers/assessment-intake/prepare']);
});
