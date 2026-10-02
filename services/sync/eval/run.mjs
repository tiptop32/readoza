import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.mjs';

// Scenario eval: two named readers, a stale writer and a final read of the
// stored state through the real Worker handler. 100% of these steps must pass.
const rows = new Map();
const DB = { prepare(sql) { return {
  bind(...values) { this.values = values; return this; },
  async first() { return structuredClone(rows.get(this.values[0]) ?? null); },
  async run() {
    const values = this.values;
    if (sql.startsWith('INSERT')) {
      if (rows.has(values[0])) return { meta: { changes: 0 } };
      rows.set(values[0], { code_salt: values[1], code_hash: values[2], revision: 0, snapshot: values[3] });
      return { meta: { changes: 1 } };
    }
    const row = rows.get(values[2]);
    if (!row || row.revision !== values[3]) return { meta: { changes: 0 } };
    row.revision = values[0]; row.snapshot = values[1];
    return { meta: { changes: 1 } };
  },
}; } };
const origin = 'https://tiptop32.github.io';
const env = { DB, READOZA_ALLOWED_ORIGIN: origin };
const code = '0123456789abcdef0123456789abcdef';
async function call(path, body) {
  const request = new Request(`https://sync.test${path}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await handleRequest(request, env);
  return { status: response.status, body: await response.json() };
}
const channel = { id: 'telegram-public:news', source: 'telegram-public', username: 'news', title: 'News', importState: 'none', addedAt: '2026-01-01T00:00:00Z' };
const snapshot = { channels: [channel], progress: { [channel.id]: { channelId: channel.id, lastReadId: 42, furthestReadId: 42, lastReadAt: '2026-01-02T00:00:00Z', startedAt: '2026-01-01T00:00:00Z' } } };
assert.equal((await call('/v1/sync/login', { nickname: 'reader1', code })).status, 200);
assert.equal((await call('/v1/sync/login', { nickname: 'reader2', code })).status, 200);
assert.equal((await call('/v1/sync/save', { nickname: 'reader1', code, baseRevision: 0, snapshot })).status, 200);
assert.equal((await call('/v1/sync/save', { nickname: 'reader1', code, baseRevision: 0, snapshot })).status, 409);
assert.deepEqual((await call('/v1/sync/login', { nickname: 'reader1', code })).body.snapshot, snapshot);
assert.deepEqual((await call('/v1/sync/login', { nickname: 'reader2', code })).body.snapshot, { channels: [], progress: {} });
console.log('Sync scenario eval: 6/6 passed');
