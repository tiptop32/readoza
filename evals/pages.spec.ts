import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import worker from "../services/telegram-proxy/src/index.mjs";

const proxy = process.env.VITE_TG_PROXY;
if (!proxy) throw new Error("Run eval:dist with the same VITE_TG_PROXY used to build dist");
const fixture = (name: string) => readFileSync(`src/core/source/telegram/__fixtures__/${name}`, "utf8");
const evidence = process.env.READOZA_EVIDENCE_DIR ?? "/tmp/readoza-pages";
mkdirSync(evidence, { recursive: true });

test("Pages artifact imports through the Worker, restores progress and starts offline", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const calls: string[] = [];
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
  try {
    await page.route(`${proxy}/**`, async (route) => {
      calls.push(route.request().url());
      const response = await worker.fetch(new Request(route.request().url(), {
        headers: { Origin: "http://127.0.0.1:4175" },
      }), { READOZA_ALLOWED_ORIGIN: "http://127.0.0.1:4175" });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    await page.route(/telesco\.pe|telegram\.org/, (route) => route.fulfill({ path: "public/icon-192.png", contentType: "image/png" }));
    await page.goto("./");
    await expect(page.getByRole("heading", { name: "Readoza" })).toBeVisible();

    const manifestUrl = await page.locator('link[rel="manifest"]').evaluate((node) => (node as HTMLLinkElement).href);
    expect(new URL(manifestUrl).pathname).toBe("/readoza/manifest.webmanifest");
    const manifest = await page.evaluate(async (url) => (await fetch(url)).json(), manifestUrl);
    expect(manifest.start_url).toBe("/readoza/");
    expect(manifest.scope).toBe("/readoza/");
    for (const icon of manifest.icons) {
      const url = new URL(icon.src, manifestUrl).href;
      expect(new URL(url).pathname).toMatch(/^\/readoza\//);
      expect((await page.request.get(url)).status()).toBe(200);
    }
    const registration = await page.evaluate(async () => {
      const sw = await navigator.serviceWorker.ready;
      return { scope: sw.scope, script: sw.active?.scriptURL };
    });
    expect(new URL(registration.scope).pathname).toBe("/readoza/");
    expect(new URL(registration.script!).pathname).toBe("/readoza/sw.js");
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await page.getByLabel("Telegram channel").fill("t.me/sys_sa");
    await page.getByRole("button", { name: /start from the beginning/i }).click();
    await expect(page.locator("#post-1")).toBeVisible();
    expect(calls.some((url) => url.startsWith(`${proxy}/sys_sa`))).toBe(true);
    expect(calls.some((url) => url === `${proxy}/s/sys_sa?before=2`)).toBe(true);
    for (let i = 0; i < 4; i += 1) { await page.mouse.wheel(0, 1600); await page.waitForTimeout(300); }
    await page.waitForTimeout(1200);
    const readId = await page.locator(".post--read").evaluateAll((nodes) => Math.max(...nodes.map((node) => Number((node as HTMLElement).dataset.postId))));
    expect(readId).toBeGreaterThan(1);
    await page.reload();
    await expect(page.getByText(/posts read/)).toBeVisible();
    await page.getByRole("button", { name: /^Системный Аналитик/ }).click();
    await expect(page.locator(`#post-${readId}`)).toBeVisible();
    await page.screenshot({ path: `${evidence}/pages-reader.png`, fullPage: false });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Readoza" })).toBeVisible();
    await page.getByRole("button", { name: /^Системный Аналитик/ }).click();
    await expect(page.locator(`#post-${readId}`)).toBeVisible();
    await expect(page.getByText("You are offline. Everything already downloaded is still readable.")).toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({ path: `${evidence}/pages-offline.png`, fullPage: false });
  } finally {
    globalThis.fetch = originalFetch;
    await context.setOffline(false);
  }
});

test("proxy failure is shown to the reader instead of a channel that silently disappeared", async ({ page }) => {
  await page.route(`${proxy}/**`, (route) => route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"upstream unavailable"}' }));
  await page.goto("./");
  await page.getByLabel("Telegram channel").fill("t.me/sys_sa");
  await expect(page.getByText("Could not reach Telegram. Try again.")).toBeVisible();
});
