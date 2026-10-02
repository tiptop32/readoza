const TELEGRAM = "https://t.me";
const MAX_BYTES = 1_500_000;
const DEADLINE_MS = 12_000;
const PUBLIC_PATH = /^\/(?:s\/)?[A-Za-z0-9_]{4,32}$/;

function pagination(url) {
  const entries = [...url.searchParams];
  if (entries.length === 0) return "";
  if (entries.length !== 1) return null;
  const [key, value] = entries[0];
  if (!/^(before|after)$/.test(key) || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  return `?${key}=${value}`;
}

function redirectTarget(location, current) {
  if (!location) return null;
  try {
    const target = new URL(location, current);
    if (target.origin !== TELEGRAM || target.username || target.password || target.hash) return null;
    if (!PUBLIC_PATH.test(target.pathname) || pagination(target) === null) return null;
    return target;
  } catch {
    return null;
  }
}

function cancel(response) {
  // Cancellation must not postpone the response to the reader.
  void response.body?.cancel().catch(() => {});
}

export default {
  async fetch(request, env = {}) {
    const allowedOrigin = env.READOZA_ALLOWED_ORIGIN ?? "https://tiptop32.github.io";
    const origin = request.headers.get("Origin");
    const headers = new Headers({ Vary: "Origin", "Cache-Control": "no-store" });
    if (origin === null || origin === allowedOrigin) {
      headers.set("Access-Control-Allow-Origin", allowedOrigin);
      headers.set("Access-Control-Expose-Headers", "Retry-After");
    }
    const failure = (message, status) => {
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ error: message }), { status, headers });
    };
    if (origin !== null && origin !== allowedOrigin) return failure("origin not allowed", 403);
    if (request.method === "OPTIONS") {
      const method = request.headers.get("Access-Control-Request-Method");
      if (method && method !== "GET") return failure("method not allowed", 405);
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET") {
      headers.set("Allow", "GET, OPTIONS");
      return failure("method not allowed", 405);
    }
    const incoming = new URL(request.url);
    const path = incoming.pathname.startsWith("/tg/") ? incoming.pathname.slice(3) : "";
    const query = pagination(incoming);
    if (!PUBLIC_PATH.test(path) || query === null) return failure("route or query not allowed", 400);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
    let reader;
    let onAbort;
    // The same deadline covers both connection and every body chunk.
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(new DOMException("upstream timeout", "AbortError"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      let target = new URL(path + query, TELEGRAM);
      let response;
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        response = await Promise.race([
          fetch(target.href, {
            redirect: "manual",
            signal: controller.signal,
            headers: { Accept: "text/html", "Accept-Language": "en" },
          }),
          aborted,
        ]);
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const next = redirectTarget(response.headers.get("Location"), target);
        cancel(response);
        if (!next || redirects === 3) return failure("upstream redirect rejected", 502);
        target = next;
      }
      if (!response.ok) {
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) headers.set("Retry-After", retryAfter);
        cancel(response);
        return failure(`upstream HTTP ${response.status}`, response.status);
      }
      if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")) {
        cancel(response);
        return failure("upstream did not return HTML", 502);
      }
      if (!response.body || Number(response.headers.get("Content-Length")) > MAX_BYTES) {
        cancel(response);
        return failure("upstream response rejected", 502);
      }
      reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      for (;;) {
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BYTES) return failure("upstream response too large", 502);
        chunks.push(part.value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      headers.set("Content-Type", "text/html; charset=utf-8");
      return new Response(body, { headers });
    } catch (cause) {
      return failure(
        cause?.name === "AbortError" ? "upstream timeout" : "upstream unavailable",
        cause?.name === "AbortError" ? 504 : 502,
      );
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      void reader?.cancel().catch(() => {});
      controller.abort();
    }
  },
};
