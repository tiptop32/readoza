import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import worker from "./index.mjs";

const ORIGIN = "https://reader.example";
const env = { READOZA_ALLOWED_ORIGIN: ORIGIN };
const request = (path, init = {}) => new Request(`https://proxy.example${path}`, {
  ...init, headers: { Origin: ORIGIN, ...init.headers },
});
const html = (body = "<html>feed</html>", extra = {}) => new Response(body, {
  ...extra, headers: { "Content-Type": "text/html; charset=utf-8", ...extra.headers },
});
afterEach(() => mock.restoreAll());

test("public channel, feed and pagination use the fixed Telegram host", async () => {
  const upstream = mock.method(globalThis, "fetch", async () => html());
  for (const suffix of ["/sys_sa", "/s/sys_sa", "/s/sys_sa?before=2", "/s/sys_sa?after=143"]) {
    const response = await worker.fetch(request(`/tg${suffix}`), env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "<html>feed</html>");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const [url, init] = upstream.mock.calls.at(-1).arguments;
    assert.equal(url, `https://t.me${suffix}`);
    assert.equal(init.redirect, "manual");
  }
});

test("invalid routes, duplicate cursors, methods and foreign origins never reach Telegram", async () => {
  const upstream = mock.method(globalThis, "fetch", async () => { throw new Error("unexpected fetch"); });
  for (const path of ["/https://evil.example", "/s/sys_sa", "/tg//evil.example", "/tg/a", "/tg/s/sys_sa/1",
    "/tg/s/sys_sa?url=https://evil.example", "/tg/s/sys_sa?before=0", "/tg/s/sys_sa?after=-1",
    "/tg/s/sys_sa?before=2&before=3", "/tg/s/sys_sa?before=2&after=3", "/tg/%2Fsys_sa"]) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 400, path);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  }
  const method = await worker.fetch(request("/tg/sys_sa", { method: "POST" }), env);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("Allow"), "GET, OPTIONS");
  const denied = await worker.fetch(request("/tg/sys_sa", { headers: { Origin: "https://evil.example" } }), env);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(upstream.mock.callCount(), 0);
});

test("GET preflight succeeds only for the configured origin", async () => {
  const upstream = mock.method(globalThis, "fetch", async () => html());
  const response = await worker.fetch(request("/tg/sys_sa", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "GET" } }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
  assert.equal(upstream.mock.callCount(), 0);
});

test("upstream error status and Retry-After remain readable through CORS", async () => {
  for (const status of [404, 429, 500, 503]) {
    mock.method(globalThis, "fetch", async () => new Response("failure", { status, headers: { "Retry-After": "30" } }));
    const response = await worker.fetch(request("/tg/sys_sa"), env);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Retry-After"), "30");
    assert.equal(response.headers.get("Access-Control-Expose-Headers"), "Retry-After");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assert.match((await response.json()).error, new RegExp(String(status)));
    mock.restoreAll();
  }
});

test("same-host channel aliases work; unsafe redirects and loops fail", async () => {
  const upstream = mock.method(globalThis, "fetch", async (url) => url.includes("old_chan")
    ? new Response(null, { status: 302, headers: { Location: "/s/new_chan?before=2" } }) : html());
  assert.equal((await worker.fetch(request("/tg/s/old_chan"), env)).status, 200);
  assert.equal(upstream.mock.calls[1].arguments[0], "https://t.me/s/new_chan?before=2");
  mock.restoreAll();
  for (const location of ["https://evil.example/s/sys_sa", "https://t.me@evil.example/x", "http://t.me/sys_sa",
    "https://user:pass@t.me/sys_sa", "/login", "/sys_sa?url=x", "/s/sys_sa"]) {
    const calls = mock.method(globalThis, "fetch", async () => new Response("redirect", { status: 302, headers: { Location: location } }));
    const response = await worker.fetch(request("/tg/s/sys_sa"), env);
    assert.equal(response.status, 502, location);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assert.ok(calls.mock.callCount() <= 4);
    assert.ok(calls.mock.calls.every((call) => new URL(call.arguments[0]).origin === "https://t.me"));
    mock.restoreAll();
  }
});

test("non-HTML and oversized declared or streamed bodies fail before returning HTML", async () => {
  for (const factory of [
    () => new Response("json", { headers: { "Content-Type": "application/json" } }),
    () => html("small", { headers: { "Content-Length": "1500001" } }),
    () => html(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(800_000));
      controller.enqueue(new Uint8Array(800_000));
      controller.close();
    } })),
  ]) {
    mock.method(globalThis, "fetch", async () => factory());
    const response = await worker.fetch(request("/tg/sys_sa"), env);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    mock.restoreAll();
  }
});

test("a network failure is a CORS-visible retryable error", async () => {
  mock.method(globalThis, "fetch", async () => { throw new TypeError("network"); });
  const response = await worker.fetch(request("/tg/sys_sa"), env);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("the deadline covers both a stalled connection and a stalled response body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const stalledBody of [false, true]) {
    mock.method(globalThis, "fetch", () => stalledBody
      ? Promise.resolve(html(new ReadableStream({ pull() {} }))) : new Promise(() => {}));
    const pending = worker.fetch(request("/tg/sys_sa"), env);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    t.mock.timers.tick(12_000);
    const response = await pending;
    assert.equal(response.status, 504);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assert.match((await response.json()).error, /timeout/);
    mock.restoreAll();
  }
});
