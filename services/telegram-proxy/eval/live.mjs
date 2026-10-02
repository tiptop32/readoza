import assert from "node:assert/strict";

const base = process.env.TG_PROXY_URL;
assert.ok(base, "Set TG_PROXY_URL to the deployed HTTPS Worker URL ending in /tg");
const origin = process.env.READOZA_ALLOWED_ORIGIN ?? "https://tiptop32.github.io";
for (const path of ["/sys_sa", "/s/sys_sa?before=2"]) {
  const response = await fetch(base + path, { headers: { Origin: origin }, signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.match(response.headers.get("Content-Type") ?? "", /^text\/html/);
  const body = await response.text();
  assert.match(body, path.startsWith("/s/") ? /data-post="sys_sa\// : /tgme_page_title/);
  console.log(JSON.stringify({ path, status: response.status, bytes: Buffer.byteLength(body), pass: true }));
}
