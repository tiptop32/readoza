// Replay the saved Telegram corpus through the real Worker boundary.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import worker from "../src/index.mjs";

const directory = new URL("../../../src/core/source/telegram/__fixtures__/", import.meta.url);
const originalFetch = globalThis.fetch;
const results = [];
try {
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".html"))) {
    const body = await readFile(new URL(name, directory));
    globalThis.fetch = async (url) => {
      assert.equal(url, "https://t.me/s/sys_sa?before=2");
      return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    };
    const response = await worker.fetch(new Request("https://proxy.example/tg/s/sys_sa?before=2", {
      headers: { Origin: "https://tiptop32.github.io" },
    }));
    const actual = Buffer.from(await response.arrayBuffer());
    const pass = response.status === 200 && actual.equals(body)
      && response.headers.get("Access-Control-Allow-Origin") === "https://tiptop32.github.io";
    results.push({ name, bytes: body.byteLength, pass });
  }
} finally { globalThis.fetch = originalFetch; }
const score = results.filter((row) => row.pass).length / results.length;
console.log(JSON.stringify({ results, score, threshold: 1 }, null, 2));
if (score !== 1) process.exitCode = 1;
