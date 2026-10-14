/** Full profile snapshot size guards. Synthetic data and local SQLite only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

function load(path, imports = {}) {
  const exports = {};
  const source = fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: name => imports[name], crypto: webcrypto, TextEncoder, Uint8Array, Date, JSON });
  return exports;
}
const evidence = load('lib/documents/repository.ts');
const { ProfileSaveRepository } = load('lib/questionnaire/profile-save-repository.ts', { '../documents/repository': evidence });
const requestId = '00000000-0000-0000-0000-000000000001';
const actor = { id: 'worker:synthetic', authentication: 'synthetic-test' };
const record = { id: 'size-case', identity_revision: 1 };
const maxEnvelopeBytes = 1_500_000;
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

function payload() {
  const answers = Array.from({ length: 46 }, (_, row) => Array.from({ length: 10 }, (_, field) => ({
    key: 'synthetic' + field, label: 'Синтетическое поле обязательства ' + field,
    value: 'Синтетическое значение обязательства ' + row, group: 'creditors', row,
  }))).flat();
  return {
    schemaVersion: 1, dealId: '900001',
    draft: { schemaVersion: 1, answers: [], groups: [], docContext: { social: '0', salary: '0' }, documents: [], pendingFiles: [] },
    baseline: { fio: '', marital: 'SYNTHETIC BEFORE', debt: '1.00' },
    values: { fio: 'SYNTHETIC AFTER', marital: 'SYNTHETIC AFTER', debt: '46.00',
      profileCard: 'ПРОФИЛЬ КЛИЕНТА\n' + answers.map(a => `${a.row + 1}: ${a.value}`).join('\n'),
      profileJson: JSON.stringify({ schema: 'antikrizis.profile.v1', dealId: '900001', iin: '000000000010',
        savedAt: '2026-10-14T00:00:00.000Z', savedBy: 'SYNTHETIC', totalDebt: '46.00', debtComplete: true, answers, unresolved: [] }),
      profileAt: '2026-10-14T00:00:00.000Z · SYNTHETIC' },
    unresolvedCount: 0,
  };
}

// The envelope includes the independently supplied CRM baseline, not just compiled fields.
function sizedPayload(target) {
  const value = payload(), remaining = target - bytes(value);
  assert.ok(remaining >= 0);
  value.baseline.fio = 'Я'.repeat(Math.floor(remaining / 2)) + 'a'.repeat(remaining % 2);
  assert.equal(bytes(value), target);
  return value;
}

function setup(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort())
    sqlite.exec(fs.readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  sqlite.exec("INSERT INTO assessment_cases (id,external_system,external_id,identity_revision,title,created_at,updated_at) VALUES ('size-case','bitrix','900001',1,'SYNTHETIC','now','now')");
  const statements = [];
  const db = { prepare(sql) {
    statements.push(sql);
    return { bind(...args) {
      const query = sqlite.prepare(sql);
      return { async run() { return { success: true, meta: { changes: Number(query.run(...args).changes) } }; },
        async first() { return query.get(...args) || null; } };
    } };
  } };
  return { sqlite, db, statements, repo: new ProfileSaveRepository(db) };
}

test('profile envelope over the UTF-8 budget is rejected before any SQL', async t => {
  const { repo, sqlite, statements } = setup(t), value = sizedPayload(maxEnvelopeBytes + 1);
  assert.ok(JSON.stringify(value).length < maxEnvelopeBytes, 'character counting would incorrectly admit this Cyrillic payload');
  await assert.rejects(repo.begin(record, requestId, value, actor), error => error.code === 'PROFILE_TOO_LARGE' && error.status === 413);
  assert.equal(statements.length, 0, 'no SQL, including an attempted INSERT, is allowed');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_profile_saves').get().count, 0);
});

test('profile envelope at the byte budget preserves the complete snapshot and hash after restart', async t => {
  const { repo, db } = setup(t), value = sizedPayload(maxEnvelopeBytes), serialized = JSON.stringify(value);
  assert.ok(Buffer.byteLength(value.values.profileJson, 'utf8') > 60_000);
  const saved = await repo.begin(record, requestId, value, actor);
  assert.equal(saved.state, 'writing');
  const restored = await new ProfileSaveRepository(db).get(record.id, requestId);
  assert.equal(restored.payload_json, serialized);
  assert.equal(restored.payload_hash, createHash('sha256').update(serialized, 'utf8').digest('hex'));
  assert.deepEqual(JSON.parse(restored.payload_json), value);
  const profile = JSON.parse(JSON.parse(restored.payload_json).values.profileJson);
  assert.equal(profile.answers.length, 460);
  assert.equal(new Set(profile.answers.map(answer => answer.row)).size, 46);
  assert.deepEqual(profile.answers.at(-1), JSON.parse(value.values.profileJson).answers.at(-1));
});
