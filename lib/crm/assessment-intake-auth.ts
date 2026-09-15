/**
 * Restricted machine-to-machine authentication for the Assessment -> CRM
 * read boundary.  This secret is deliberately separate from the generic CRM
 * webhook secret and is never used by the staff cookie routes.
 */

import { canonicalJsonStringify } from './assessment-intake-export';

const MAX_SKEW_MS = 5 * 60 * 1_000;
const MAX_BODY_BYTES = 64 * 1_024;
const replayed = new Map<string, number>();

export class AssessmentIntakeAuthError extends Error {
  constructor(public readonly code: string, public readonly status = 401) {
    super(code);
  }
}

export type AssessmentIntakeReplayStore = Map<string, number>;

const encoder = new TextEncoder();

function equal(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function digest(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function signedAssessmentIntakeHeaders(input: {
  secret: string;
  body: string;
  sourceOrigin: string;
  now?: number;
}): Promise<Record<string, string>> {
  const timestamp = String(input.now ?? Date.now());
  return {
    'x-antikrizis-source-origin': input.sourceOrigin,
    'x-antikrizis-timestamp': timestamp,
    'x-antikrizis-signature': `sha256=${await digest(input.secret, `${timestamp}.${input.body}`)}`,
  };
}

export function assessmentIntakeSignedBody(value: unknown): string {
  return canonicalJsonStringify(value);
}

/**
 * Verify a canonical signed operation and consume its timestamp/signature
 * replay key.  The origin is an allow-list check; the HMAC remains the caller
 * authentication.  A caller can pass an isolated store in tests or a worker
 * invocation boundary.
 */
export async function verifyAssessmentIntakeRequest(input: {
  request: Request;
  body: string;
  secret: string | undefined;
  approvedOrigin: string | undefined;
  replayStore?: AssessmentIntakeReplayStore;
  now?: number;
}): Promise<void> {
  const { request, body, secret, approvedOrigin, replayStore = replayed, now = Date.now() } = input;
  if (!secret || secret.length < 32) throw new AssessmentIntakeAuthError('assessment_intake_auth_unavailable', 503);
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    throw new AssessmentIntakeAuthError('assessment_intake_body_too_large', 413);
  }
  if (!approvedOrigin) throw new AssessmentIntakeAuthError('assessment_intake_origin_unavailable', 503);
  let allowed: URL;
  try { allowed = new URL(approvedOrigin); } catch { throw new AssessmentIntakeAuthError('assessment_intake_origin_invalid', 503); }
  const loopbackHttp = allowed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(allowed.hostname);
  if ((allowed.protocol !== 'https:' && !loopbackHttp) || allowed.pathname !== '/' || allowed.search || allowed.hash) {
    throw new AssessmentIntakeAuthError('assessment_intake_origin_invalid', 503);
  }
  const sourceOrigin = request.headers.get('x-antikrizis-source-origin');
  const requestOrigin = request.headers.get('origin');
  if (sourceOrigin !== allowed.origin || (requestOrigin !== null && requestOrigin !== allowed.origin)) {
    throw new AssessmentIntakeAuthError('assessment_intake_origin_forbidden', 403);
  }
  const timestampText = request.headers.get('x-antikrizis-timestamp');
  const signatureText = request.headers.get('x-antikrizis-signature');
  if (!timestampText || !/^\d{10,13}$/u.test(timestampText)) {
    throw new AssessmentIntakeAuthError('assessment_intake_signature_invalid');
  }
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_SKEW_MS) {
    throw new AssessmentIntakeAuthError('assessment_intake_timestamp_invalid');
  }
  if (!signatureText || !/^sha256=[0-9a-f]{64}$/iu.test(signatureText)) {
    throw new AssessmentIntakeAuthError('assessment_intake_signature_invalid');
  }
  const expected = `sha256=${await digest(secret, `${timestampText}.${body}`)}`;
  if (!equal(expected.toLowerCase(), signatureText.toLowerCase())) {
    throw new AssessmentIntakeAuthError('assessment_intake_signature_invalid');
  }
  const replayKey = `${timestampText}.${signatureText.toLowerCase()}`;
  for (const [key, expiresAt] of replayStore) if (expiresAt <= now) replayStore.delete(key);
  if (replayStore.has(replayKey)) throw new AssessmentIntakeAuthError('assessment_intake_replayed', 409);
  replayStore.set(replayKey, timestamp + MAX_SKEW_MS);
}

export function parseCanonicalJson(value: string, code = 'assessment_intake_json_invalid'): Record<string, unknown> {
  if (new TextEncoder().encode(value).byteLength > MAX_BODY_BYTES) {
    throw new AssessmentIntakeAuthError('assessment_intake_body_too_large', 413);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new AssessmentIntakeAuthError(code, 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AssessmentIntakeAuthError(code, 400);
  if (canonicalJsonStringify(parsed) !== value) throw new AssessmentIntakeAuthError('assessment_intake_json_not_canonical', 400);
  return parsed as Record<string, unknown>;
}

export function decodeCanonicalHeader(value: string | null): Record<string, unknown> {
  if (!value || value.length > MAX_BODY_BYTES) throw new AssessmentIntakeAuthError('assessment_intake_request_missing', 400);
  let text: string;
  try {
    const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - value.length % 4) % 4);
    text = new TextDecoder().decode(Uint8Array.from(atob(normalized), character => character.charCodeAt(0)));
  } catch { throw new AssessmentIntakeAuthError('assessment_intake_request_invalid', 400); }
  return parseCanonicalJson(text, 'assessment_intake_request_invalid');
}

export function encodeCanonicalHeader(value: unknown): string {
  return btoa(String.fromCharCode(...encoder.encode(assessmentIntakeSignedBody(value))))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
