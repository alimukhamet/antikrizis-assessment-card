import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function moduleAt(path, dependencies = {}, env = {}) {
  const exports = {};
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
    exports, require: name => { if (!(name in dependencies)) throw Error(name); return dependencies[name]; },
    process: {env}, Request, Response, URL, URLSearchParams, TextDecoder, TextEncoder, Uint8Array, crypto, atob, btoa,
  });
  return exports;
}
const session = moduleAt('../lib/worker-session.ts');
const navigation = moduleAt('../lib/login-navigation.ts');
const origin = 'https://synthetic.invalid';
const destination = '/assessment-review?dealId=11665';
function fixture({denied = false, rateLimited = false, unavailable = false} = {}) {
  let calls = 0;
  const route = moduleAt('../app/api/session/route.ts', {
    '../../../lib/worker-session': session,
    '../../../lib/login-navigation': navigation,
    '../../../lib/login-rate': {checkLoginRate: async () => ({allowed: !rateLimited, retryAfter: 60})},
    '../../../lib/auth-provider': {authenticateStaff: async (worker, password, configuration) => {
      calls++; assert.equal(configuration.provider, 'payment-control');
      if (unavailable) throw Error('test provider outage');
      assert.equal(worker, 'ramazan');
      return denied ? null : session.authenticateWorker(worker, password, 'synthetic');
    }},
  }, {SITE_SESSION_TOKEN: 'isolated-login-flow-test-secret-only'});
  const form = (body = {worker: 'ramazan', password: 'synthetic', returnTo: destination}, headers = {}) => new Request(origin + '/api/session', {
    method: 'POST', headers: {origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded', ...headers},
    body: typeof body === 'string' ? body : new URLSearchParams(body),
  });
  return {route, form, calls: () => calls};
}

test('native login retains a signed cookie, verifies it and returns to the requested deal', async () => {
  const {route, form} = fixture();
  const login = await route.POST(form());
  assert.equal(login.status, 303);
  assert.match(login.headers.get('set-cookie'), /^__Host-antikrizis_assessment_session=.+; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict$/);
  const continuation = new URL(login.headers.get('location'), origin);
  assert.equal(continuation.pathname, '/api/session');
  assert.equal(continuation.searchParams.get('continue'), '1');
  assert.equal(continuation.searchParams.get('returnTo'), destination);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const entered = await route.GET(new Request(continuation, {headers: {cookie}}));
  assert.equal(entered.status, 303);
  assert.equal(entered.headers.get('location'), destination);
  assert.equal(entered.headers.get('cache-control'), 'no-store');
  const readback = await route.GET(new Request(origin + '/api/session', {headers: {cookie}}));
  assert.equal(readback.status, 200);
  assert.equal((await readback.json()).actor.worker, 'ramazan');
});

test('missing browser cookie produces a useful error rather than another protected-page login loop', async () => {
  const {route} = fixture();
  const response = await route.GET(new Request(origin + '/api/session?continue=1&returnTo=' + encodeURIComponent(destination)));
  const location = new URL(response.headers.get('location'), origin);
  assert.equal(response.status, 303);
  assert.equal(location.pathname, '/login');
  assert.equal(location.searchParams.get('error'), 'cookies');
  assert.equal(location.searchParams.get('returnTo'), destination);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('wrong password is not reflected or saved and preserves only the chosen worker and deal', async () => {
  const {route, form} = fixture({denied: true});
  const password = 'private+&value-must-not-appear';
  const response = await route.POST(form({worker: 'ramazan', password, returnTo: destination + '&password=' + password}));
  const location = new URL(response.headers.get('location'), origin);
  assert.equal(location.searchParams.get('error'), 'credentials');
  assert.equal(location.searchParams.get('worker'), 'ramazan');
  assert.equal(location.searchParams.get('returnTo'), destination);
  assert.ok(!location.toString().includes(password));
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(await response.text(), '');
});

test('native login rejects cross-site submissions before authentication', async () => {
  const {route, form, calls} = fixture();
  for (const headers of [{origin: 'https://other.invalid'}, {origin: 'null'}, {'sec-fetch-site': 'cross-site'}]) {
    assert.equal((await route.POST(form(undefined, headers))).status, 403);
  }
  assert.equal(calls(), 0);
});

test('ambiguous or oversized native forms cannot call the identity provider', async () => {
  const {route, form, calls} = fixture();
  for (const body of ['worker=ramazan&password=synthetic&password=second', 'worker=ramazan&password=' + 'x'.repeat(4096)]) {
    const response = await route.POST(form(body));
    assert.equal(new URL(response.headers.get('location'), origin).searchParams.get('error'), 'invalid');
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(calls(), 0);
});

test('native login retains the rate limiter and distinguishes an unavailable provider', async () => {
  const limited = fixture({rateLimited: true});
  const response = await limited.route.POST(limited.form());
  assert.equal(new URL(response.headers.get('location'), origin).searchParams.get('error'), 'rate');
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(limited.calls(), 0);
  const unavailable = fixture({unavailable: true});
  const outage = await unavailable.route.POST(unavailable.form());
  assert.equal(new URL(outage.headers.get('location'), origin).searchParams.get('error'), 'unavailable');
  assert.equal(outage.headers.get('set-cookie'), null);
});

test('login redirects accept only local approved pages and a numeric deal ID', () => {
  assert.equal(navigation.loginDestination(destination), destination);
  assert.equal(navigation.loginDestination('/?dealId=11665&password=discard'), '/?dealId=11665');
  for (const value of ['https://other.invalid', '//other.invalid', '/\\other.invalid', '/api/export', 'javascript:alert(1)', '/login', null]) assert.equal(navigation.loginDestination(value), '/');
});
