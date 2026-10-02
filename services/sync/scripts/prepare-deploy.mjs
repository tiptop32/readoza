import { readFileSync, writeFileSync } from 'node:fs';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const explicitId = process.env.READOZA_D1_DATABASE_ID;
const name = 'readoza-sync';
if (!accountId || !token) throw new Error('Cloudflare account ID and API token are required');

let databaseId = explicitId;
if (!databaseId) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const listed = await fetch(`${endpoint}?per_page=100`, { headers });
  const listBody = await listed.json();
  if (!listed.ok || !listBody.success) throw new Error(`Could not list Cloudflare D1 databases (HTTP ${listed.status})`);
  const existing = listBody.result.find((database) => database.name === name);
  if (existing) databaseId = existing.uuid;
  else {
    const created = await fetch(endpoint, {
      method: 'POST', headers, body: JSON.stringify({ name, primary_location: 'EEUR' }),
    });
    const createBody = await created.json();
    if (!created.ok || !createBody.success || !createBody.result?.uuid) {
      throw new Error(`Could not create Cloudflare D1 database (HTTP ${created.status})`);
    }
    databaseId = createBody.result.uuid;
  }
}
if (!/^[0-9a-f-]{36}$/i.test(databaseId)) throw new Error('Invalid D1 database UUID');
const path = new URL('../wrangler.toml', import.meta.url);
const config = readFileSync(path, 'utf8').replace('REPLACE_WITH_D1_DATABASE_ID', databaseId);
writeFileSync(path, config);
console.log(`D1 database ${name} is ready.`);
