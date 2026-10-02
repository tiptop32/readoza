import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext } from "@playwright/test";
import telegram from "../services/telegram-proxy/src/index.mjs";
import sync from "../services/sync/src/index.mjs";

const proxy = process.env.VITE_TG_PROXY;
const syncUrl = process.env.VITE_SYNC_URL;
if (!proxy || !syncUrl) throw new Error("Build and eval:dist require VITE_TG_PROXY and VITE_SYNC_URL");
const fixture = (name: string) => readFileSync(`src/core/source/telegram/__fixtures__/${name}`, "utf8");
const browserOrigin = "http://127.0.0.1:4175";

function memoryDb() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    prepare(sql: string) {
      const statement = {
        args: [] as unknown[],
        bind(...args: unknown[]) { this.args = args; return this; },
        async first() { return structuredClone(rows.get(String(this.args[0])) ?? null); },
        async run() {
          const args = this.args;
          if (sql.startsWith("INSERT")) {
            const nickname = String(args[0]);
            if (rows.has(nickname)) return { meta: { changes: 0 } };
            rows.set(nickname, { code_salt: args[1], code_hash: args[2], revision: 0, snapshot: args[3] });
            return { meta: { changes: 1 } };
          }
          const row = rows.get(String(args[2]));
          if (!row || row.revision !== args[3]) return { meta: { changes: 0 } };
          row.revision = args[0]; row.snapshot = args[1];
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    snapshot(nickname: string) {
      const row = rows.get(nickname);
      return row ? JSON.parse(String(row.snapshot)) as {
        channels: { id: string }[]; progress: Record<string, { lastReadId: number }>;
      } : undefined;
    },
  };
}

test("two browser profiles share channels and reading position using nickname and code", async ({ browser }) => {
  const db = memoryDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://t.me");
    const name = !url.pathname.startsWith("/s/") ? "channel-page.html"
      : url.searchParams.has("before") ? "feed-start.html"
      : url.searchParams.has("after") && Number(url.searchParams.get("after")) < 100 ? "feed-mid.html"
      : "feed-latest.html";
    return new Response(fixture(name), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  };
  const contexts: BrowserContext[] = [];
  async function makeContext() {
    const context = await browser.newContext();
    contexts.push(context);
    await context.route(`${syncUrl}/**`, async (route) => {
      const req = route.request();
      const response = await sync.fetch(new Request(req.url(), {
        method: req.method(),
        headers: { Origin: browserOrigin, "Content-Type": "application/json" },
        ...(req.method() === "POST" ? { body: req.postData() ?? "" } : {}),
      }), { DB: db, READOZA_ALLOWED_ORIGIN: browserOrigin });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    await context.route(`${proxy}/**`, async (route) => {
      const response = await telegram.fetch(new Request(route.request().url(), {
        headers: { Origin: browserOrigin },
      }), { READOZA_ALLOWED_ORIGIN: browserOrigin });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    return context;
  }
  try {
    const first = await makeContext();
    const pageA = await first.newPage();
    await pageA.goto("./");
    await pageA.getByLabel("Никнейм").fill("reader_one");
    await pageA.getByRole("button", { name: "Создать код" }).click();
    const code = await pageA.getByLabel("Секретный код").inputValue();
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    await pageA.getByRole("button", { name: "Подключить профиль" }).click();
    await expect(pageA.getByText("Профиль:")).toBeVisible();
    await pageA.getByLabel("Telegram channel").fill("t.me/sys_sa");
    await pageA.getByRole("button", { name: /start from the beginning/i }).click();
    await expect(pageA.locator("#post-1")).toBeVisible();
    for (let i = 0; i < 4; i += 1) { await pageA.mouse.wheel(0, 1600); await pageA.waitForTimeout(300); }
    await expect.poll(() => db.snapshot("reader_one")?.progress["telegram-public:sys_sa"]?.lastReadId ?? 0, { timeout: 15_000 }).toBeGreaterThan(1);
    const savedId = db.snapshot("reader_one")!.progress["telegram-public:sys_sa"]!.lastReadId;
    const second = await makeContext();
    const pageB = await second.newPage();
    await pageB.goto("./");
    await pageB.getByLabel("Никнейм").fill("reader_one");
    await pageB.getByLabel("Секретный код").fill(code);
    await pageB.getByRole("button", { name: "Подключить профиль" }).click();
    await expect(pageB.getByRole("button", { name: /^Системный Аналитик/ })).toBeVisible();
    await pageB.getByRole("button", { name: /^Системный Аналитик/ }).click();
    await expect(pageB.locator(`#post-${savedId}`)).toBeVisible();
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all(contexts.map((context) => context.close()));
  }
});
