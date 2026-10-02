import { readFileSync, writeFileSync } from 'node:fs';

const id = process.env.READOZA_D1_DATABASE_ID;
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) {
  throw new Error('Set READOZA_D1_DATABASE_ID to the D1 database UUID');
}
const path = new URL('../wrangler.toml', import.meta.url);
const config = readFileSync(path, 'utf8');
if (!config.includes('REPLACE_WITH_D1_DATABASE_ID')) {
  throw new Error('Expected the D1 ID placeholder in wrangler.toml');
}
writeFileSync(path, config.replace('REPLACE_WITH_D1_DATABASE_ID', id));
