const MAX_SNAPSHOT_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = MAX_SNAPSHOT_BYTES + 2048;
const NICKNAME = /^[a-z0-9_-]{3,32}$/;
const CODE = /^[0-9a-f]{32}$/;
const EMPTY = { channels: [], progress: {} };

function corsHeaders(origin, allowedOrigin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  };
  if (origin === allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return headers;
}
function json(data, status, origin, allowedOrigin) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin, allowedOrigin) });
}
function fail(message, status, origin, allowedOrigin) {
  return json({ error: message }, status, origin, allowedOrigin);
}
function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function randomHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}
async function hashCode(code, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${code}`);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}
function equalHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function credentials(data) {
  if (!data || !NICKNAME.test(data.nickname) || !CODE.test(data.code)) {
    throw new Error('invalid nickname or code');
  }
  return data;
}
export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      !Array.isArray(snapshot.channels) || Object.keys(snapshot).some((key) => key !== 'channels' && key !== 'progress') || !snapshot.progress ||
      typeof snapshot.progress !== 'object' || Array.isArray(snapshot.progress)) {
    throw new Error('invalid snapshot');
  }
  const ids = new Set();
  for (const channel of snapshot.channels) {
    if (!channel || typeof channel !== 'object' ||
        typeof channel.id !== 'string' || channel.id.length > 128 || ids.has(channel.id) ||
        typeof channel.source !== 'string' || typeof channel.username !== 'string' ||
        typeof channel.title !== 'string' || typeof channel.addedAt !== 'string' ||
        !['none', 'partial', 'complete'].includes(channel.importState)) {
      throw new Error('invalid channel');
    }
    ids.add(channel.id);
  }
  for (const [id, progress] of Object.entries(snapshot.progress)) {
    if (!ids.has(id) || !progress || progress.channelId !== id ||
        !Number.isSafeInteger(progress.lastReadId) || progress.lastReadId < 1 ||
        (progress.furthestReadId !== undefined &&
          (!Number.isSafeInteger(progress.furthestReadId) || progress.furthestReadId < progress.lastReadId)) ||
        typeof progress.lastReadAt !== 'string' || typeof progress.startedAt !== 'string') {
      throw new Error('invalid progress');
    }
  }
  const text = JSON.stringify({ channels: snapshot.channels, progress: snapshot.progress });
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error('snapshot is too large');
  }
  return text;
}
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid JSON');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error('request is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('invalid JSON'); }
}
async function findAccount(db, nickname) {
  return db.prepare('SELECT code_salt, code_hash, revision, snapshot FROM accounts WHERE nickname = ?1')
    .bind(nickname).first();
}
async function login(db, data) {
  credentials(data);
  let account = await findAccount(db, data.nickname);
  let created = false;
  if (!account) {
    const salt = randomHex();
    const hash = await hashCode(data.code, salt);
    const result = await db.prepare(
      'INSERT INTO accounts (nickname, code_salt, code_hash, revision, snapshot) VALUES (?1, ?2, ?3, 0, ?4) ON CONFLICT(nickname) DO NOTHING',
    ).bind(data.nickname, salt, hash, JSON.stringify(EMPTY)).run();
    created = result.meta?.changes === 1;
    account = await findAccount(db, data.nickname);
  }
  if (!account || !equalHash(account.code_hash, await hashCode(data.code, account.code_salt))) {
    throw new Error('invalid credentials');
  }
  return { revision: account.revision, snapshot: JSON.parse(account.snapshot), created };
}
async function save(db, data, origin, allowedOrigin) {
  credentials(data);
  if (!Number.isSafeInteger(data.baseRevision) || data.baseRevision < 0) {
    throw new Error('invalid baseRevision');
  }
  const snapshot = validateSnapshot(data.snapshot);
  const account = await findAccount(db, data.nickname);
  if (!account || !equalHash(account.code_hash, await hashCode(data.code, account.code_salt))) {
    throw new Error('invalid credentials');
  }
  if (account.revision !== data.baseRevision) {
    return json({ revision: account.revision, snapshot: JSON.parse(account.snapshot) }, 409, origin, allowedOrigin);
  }
  const revision = data.baseRevision + 1;
  const result = await db.prepare(
    'UPDATE accounts SET revision = ?1, snapshot = ?2 WHERE nickname = ?3 AND revision = ?4',
  ).bind(revision, snapshot, data.nickname, data.baseRevision).run();
  if (result.meta?.changes !== 1) {
    const latest = await findAccount(db, data.nickname);
    return json({ revision: latest.revision, snapshot: JSON.parse(latest.snapshot) }, 409, origin, allowedOrigin);
  }
  return json({ revision }, 200, origin, allowedOrigin);
}
export async function handleRequest(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  const allowedOrigin = env.READOZA_ALLOWED_ORIGIN || 'https://tiptop32.github.io';
  if (origin !== allowedOrigin) return fail('origin not allowed', 403, origin, allowedOrigin);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigin) });
  }
  if (request.method !== 'POST') return fail('method not allowed', 405, origin, allowedOrigin);
  if (Number(request.headers.get('Content-Length')) > MAX_REQUEST_BYTES) {
    return fail('request is too large', 413, origin, allowedOrigin);
  }
  const path = new URL(request.url).pathname;
  if (path !== '/v1/sync/login' && path !== '/v1/sync/save') {
    return fail('not found', 404, origin, allowedOrigin);
  }
  try {
    const data = await readBody(request);
    if (path === '/v1/sync/login') return json(await login(env.DB, data), 200, origin, allowedOrigin);
    return await save(env.DB, data, origin, allowedOrigin);
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'invalid credentials') {
      return fail('invalid credentials', 401, origin, allowedOrigin);
    }
    if (cause instanceof Error && cause.message === 'request is too large') {
      return fail(cause.message, 413, origin, allowedOrigin);
    }
    if (cause instanceof Error && /^(invalid|snapshot)/.test(cause.message)) {
      return fail(cause.message, 400, origin, allowedOrigin);
    }
    console.error('sync request failed', cause);
    return fail('internal error', 500, origin, allowedOrigin);
  }
}
export default { fetch: handleRequest };
