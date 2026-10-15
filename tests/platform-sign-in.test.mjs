import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {generateKeyPairSync, sign, randomUUID} from 'node:crypto';

function moduleAt(path, dependencies = {}, env = {}) {
  const exports = {};
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
    exports, require: name => { if (!(name in dependencies)) throw Error(name); return dependencies[name]; },
    process: {env}, Request, Response, Headers, URL, URLSearchParams, TextDecoder, TextEncoder, Uint8Array, crypto, atob, btoa, JSON, Object, Math, Number, Error, Promise,
  });
  return exports;
}
const b64 = value => Buffer.from(value).toString('base64url');
const pair = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519');
const publicKey = b64(pair.publicKey.export({format: 'der', type: 'spki'}).subarray(-32));
const session = moduleAt('../lib/worker-session.ts');
const navigation = moduleAt('../lib/login-navigation.ts');
const realSignIn = moduleAt('../lib/platform-sign-in.ts');
const ticket = (claims = {}, key = pair.privateKey) => {
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64(JSON.stringify({v: 1, aud: 'assessment', sub: 'prod-admin-1', name: 'Synthetic', iat, exp: iat + 60, jti: randomUUID(), ...claims}));
  return payload + '.' + b64(sign(null, Buffer.from(payload), key));
};
function fixture(env = {}) {
  const used = new Set();
  const route = moduleAt('../app/api/session/platform/route.ts', {
    '../../../../lib/worker-session': session,
    '../../../../lib/login-navigation': navigation,
    '../../../../lib/platform-sign-in': {...realSignIn, consumePlatformTicket: async t => used.has(t.jti) ? false : (used.add(t.jti), true)},
  }, {SITE_SESSION_TOKEN: 'isolated-platform-sign-in-test-secret', PLATFORM_SSO_PUBLIC_KEY: publicKey, PLATFORM_SSO_WORKERS: JSON.stringify({'prod-admin-1': 'ali'}), ...env});
  const post = (t, {origin = 'https://platform.anti-krizis.kz', back = '/assessment-review?dealId=11665', type = 'application/x-www-form-urlencoded'} = {}) =>
    route.POST(new Request('https://assessment.anti-krizis.kz/api/session/platform', {method: 'POST', headers: {origin, 'content-type': type}, body: new URLSearchParams({ticket: t, return: back})}));
  return {post};
}
const cookies = response => response.headers.getSetCookie();

test('a Platform ticket opens the mapped worker with the normal 12-hour session and remembers the Platform entry', async () => {
  const {post} = fixture(), t = ticket(), response = await post(t);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/api/session?continue=1&returnTo=%2Fassessment-review%3FdealId%3D11665');
  const [sessionCookie, entry] = cookies(response);
  assert.match(sessionCookie, /^__Host-antikrizis_assessment_session=.+; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict$/);
  assert.equal(entry, '__Host-antikrizis_platform_entry=1; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax');
  const actor = await session.verifySession(sessionCookie.split(';')[0].split('=').slice(1).join('='), 'isolated-platform-sign-in-test-secret');
  assert.equal(actor.worker, 'ali');
  const replay = await post(t);
  assert.equal(replay.headers.get('location'), '/login?error=platform');
});

test('refuses other origins, tools, keys, stale or long tickets and unmapped employees, and forgets the Platform entry', async () => {
  const {post} = fixture();
  const old = Math.floor(Date.now() / 1000) - 120;
  for (const [response, code] of [
    [await post(ticket(), {origin: 'https://evil.example'}), 'platform'],
    [await post(ticket(), {type: 'application/json'}), 'platform'],
    [await post(ticket({aud: 'bank-mail'})), 'platform'],
    [await post(ticket({}, other.privateKey)), 'platform'],
    [await post(ticket({iat: old, exp: old + 60})), 'platform'],
    [await post(ticket({exp: Math.floor(Date.now() / 1000) + 3600})), 'platform'],
    [await post('not-a-ticket'), 'platform'],
    [await post(ticket({sub: 'prod-aizhan'})), 'platform_access'],
  ]) {
    assert.equal(response.headers.get('location'), '/login?error=' + code);
    assert.deepEqual(cookies(response), ['__Host-antikrizis_platform_entry=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax']);
  }
  const unsafe = await post(ticket(), {back: '//evil.example/x'});
  assert.equal(unsafe.headers.get('location'), '/api/session?continue=1&returnTo=%2F');
  const unset = fixture({PLATFORM_SSO_PUBLIC_KEY: ''});
  assert.equal((await unset.post(ticket())).headers.get('location'), '/login?error=platform');
});

test('the login page returns through the Platform only after a Platform entry', () => {
  const at = path => new URL('https://assessment.anti-krizis.kz' + path), mark = '__Host-antikrizis_platform_entry=1';
  assert.equal(realSignIn.platformReturn(at('/login?returnTo=%2Fassessment-review%3FdealId%3D9701'), mark, navigation.loginDestination), 'https://platform.anti-krizis.kz/sso/assessment?return=%2Fassessment-review%3FdealId%3D9701');
  assert.equal(realSignIn.platformReturn(at('/login'), mark, navigation.loginDestination), 'https://platform.anti-krizis.kz/sso/assessment?return=%2F');
  assert.equal(realSignIn.platformReturn(at('/login?error=platform&returnTo=%2F'), mark, navigation.loginDestination), null);
  assert.equal(realSignIn.platformReturn(at('/login?error=anything'), mark, navigation.loginDestination), null);
  assert.equal(realSignIn.platformReturn(at('/login'), 'other=1', navigation.loginDestination), null);
  assert.equal(realSignIn.platformReturn(at('/assessment-review'), mark, navigation.loginDestination), null);
  assert.equal(realSignIn.platformReturn(at('/login?returnTo=%2F%2Fevil.example'), mark, navigation.loginDestination), 'https://platform.anti-krizis.kz/sso/assessment?return=%2F');
  assert.equal(realSignIn.hasPlatformEntry('a=b; __Host-antikrizis_platform_entry=1'), true);
  assert.equal(realSignIn.hasPlatformEntry('__Host-antikrizis_platform_entry=0'), false);
  assert.equal(realSignIn.hasPlatformEntry(null), false);
  assert.equal(realSignIn.platformSignInUrl('/assessment-review?dealId=1'), 'https://platform.anti-krizis.kz/sso/assessment?return=%2Fassessment-review%3FdealId%3D1');
  assert.equal(navigation.LOGIN_ERRORS.platform.length > 0 && navigation.LOGIN_ERRORS.platform_access.length > 0, true);
});
