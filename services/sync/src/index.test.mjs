import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './index.mjs';

class MemoryDB {
  rows = new Map();
  prepare(sql) {
    const db = this;
    return {
      bind(...args) { this.args = args; return this; },
      async first() {
        const row = db.rows.get(this.args[0]);
        return row ? structuredClone(row) : null;
      },
      async run() {
        const a = this.args;
        if (sql.startsWith('INSERT')) {
          if (db.rows.has(a[0])) return { meta: { changes: 0 } };
          db.rows.set(a[0], { code_salt: a[1], code_hash: a[2], revision: 0, snapshot: a[3] });
          return { meta: { changes: 1 } };
        }
        const row = db.rows.get(a[2]);
        if (!row || row.revision !== a[3]) return { meta: { changes: 0 } };
        row.revision = a[0]; row.snapshot = a[1];
        return { meta: { changes: 1 } };
      },
    };
  }
}
const code = '0123456789abcdef0123456789abcdef';
const otherCode = 'fedcba9876543210fedcba9876543210';
const origin = 'https://tiptop32.github.io';
const request = (path, data, extra = {}) => new Request(`https://sync.test${path}`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extra },
  body: JSON.stringify(data),
});
const call = (db, path, data, extra) => handleRequest(request(path, data, extra), { DB: db, READOZA_ALLOWED_ORIGIN: origin });
const channel = { id: 'telegram-public:news', source: 'telegram-public', username: 'news', title: 'News', importState: 'none', addedAt: '2026-01-01T00:00:00Z' };
const progress = { channelId: channel.id, lastReadId: 7, furthestReadId: 7, startedAt: '2026-01-01T00:00:00Z', lastReadAt: '2026-01-02T00:00:00Z' };
const snapshot = { channels: [channel], progress: { [channel.id]: progress } };

test('two accounts keep independent snapshots and reject the other code', async () => {
  const db = new MemoryDB();
  assert.equal((await (await call(db, '/v1/sync/login', { nickname: 'alice', code })).json()).created, true);
  assert.equal((await call(db, '/v1/sync/login', { nickname: 'bob', code: otherCode })).status, 200);
  assert.equal((await call(db, '/v1/sync/save', { nickname: 'alice', code, baseRevision: 0, snapshot })).status, 200);
  const bob = await (await call(db, '/v1/sync/login', { nickname: 'bob', code: otherCode })).json();
  assert.deepEqual(bob.snapshot, { channels: [], progress: {} });
  assert.equal((await call(db, '/v1/sync/login', { nickname: 'alice', code: otherCode })).status, 401);
  assert.deepEqual((await (await call(db, '/v1/sync/login', { nickname: 'alice', code })).json()).snapshot, snapshot);
  for (const row of db.rows.values()) assert.equal(JSON.stringify(row).includes(code), false);
});

test('revision conflict preserves the committed snapshot', async () => {
  const db = new MemoryDB();
  await call(db, '/v1/sync/login', { nickname: 'alice', code });
  assert.equal((await call(db, '/v1/sync/save', { nickname: 'alice', code, baseRevision: 0, snapshot })).status, 200);
  const stale = await call(db, '/v1/sync/save', { nickname: 'alice', code, baseRevision: 0, snapshot: { channels: [], progress: {} } });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { revision: 1, snapshot });
  assert.equal((await call(db, '/v1/sync/save', { nickname: 'alice', code, baseRevision: 1, snapshot: { channels: [], progress: {} } })).status, 200);
});

test('rejects invalid snapshot and request bodies at the API boundary', async () => {
  const db = new MemoryDB();
  await call(db, '/v1/sync/login', { nickname: 'alice', code });
  const invalid = { channels: [channel], progress: { [channel.id]: { ...progress, lastReadId: -1 } } };
  assert.equal((await call(db, '/v1/sync/save', { nickname: 'alice', code, baseRevision: 0, snapshot: invalid })).status, 400);
  assert.equal((await call(db, '/v1/sync/save', { nickname: 'alice', code, baseRevision: 0, snapshot: { ...snapshot, posts: ['secret'] } })).status, 400);
  const tooLarge = { channels: [{ ...channel, title: 'x'.repeat(70_000) }], progress: {} };
  assert.equal((await call(db, '/v1/sync/save', { nickname: 'alice', code, baseRevision: 1, snapshot: tooLarge })).status, 413);
});

test('only the configured browser origin gets CORS and access', async () => {
  const db = new MemoryDB();
  const foreign = await call(db, '/v1/sync/login', { nickname: 'alice', code }, { Origin: 'https://evil.test' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null);
  const preflight = await handleRequest(new Request('https://sync.test/v1/sync/login', { method: 'OPTIONS', headers: { Origin: origin } }), { DB: db, READOZA_ALLOWED_ORIGIN: origin });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
});
