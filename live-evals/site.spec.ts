import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const WORKER = "https://readoza-telegram-proxy.tiptop32-readoza.workers.dev/tg";
const evidenceDir = process.env.READOZA_EVIDENCE_DIR ?? "/tmp/readoza-live";

test("public Pages site reads a real Telegram channel and remains readable offline", async ({
  page,
  context,
}) => {
  await mkdir(evidenceDir, { recursive: true });
  await page.goto("./", { waitUntil: "networkidle" });

  const title = await page.title();
  expect(title.trim()).not.toBe("");

  const manifest = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifest).toBeTruthy();
  const manifestResponse = await page.request.get(new URL(manifest!, page.url()).toString());
  expect(manifestResponse.ok()).toBe(true);
  const manifestBody = (await manifestResponse.json()) as {
    scope?: string;
    start_url?: string;
    icons?: Array<{ src?: string }>;
  };
  expect(manifestBody.scope).toBe("/readoza/");
  expect(manifestBody.start_url).toBe("/readoza/");
  expect(manifestBody.icons?.length ?? 0).toBeGreaterThanOrEqual(2);
  for (const icon of manifestBody.icons ?? []) {
    expect(icon.src).toBeTruthy();
    expect((await page.request.get(new URL(icon.src!, page.url()).toString())).ok()).toBe(true);
  }

  const registration = await page.evaluate(async () => {
    const serviceWorker = await navigator.serviceWorker.ready;
    return { scope: serviceWorker.scope, controlled: navigator.serviceWorker.controller !== null };
  });
  expect(registration.scope).toBe("https://tiptop32.github.io/readoza/");
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const channelInput = page.getByLabel("Telegram channel");
  await channelInput.fill("t.me/sys_sa");
  await expect(page.getByRole("button", { name: /start from the beginning/i })).toBeVisible();
  await page.getByRole("button", { name: /start from the beginning/i }).click();
  await expect(page.locator("[data-post-id]").first()).toBeVisible();
  const loadedCount = await page.locator("[data-post-id]").count();
  expect(loadedCount).toBeGreaterThan(0);
  const channelTitle = (await page.locator(".reader__title b").textContent())?.trim();
  expect(channelTitle).toBeTruthy();
  await page.screenshot({ path: `${evidenceDir}/live-reader.png`, fullPage: false });

  await page.getByRole("button", { name: "Back" }).click();
  const channelButton = page.locator(".entry__main").filter({ hasText: channelTitle! });
  await expect(channelButton).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await channelButton.click();
  await expect(page.locator("[data-post-id]").first()).toBeVisible();
  expect(await page.locator("[data-post-id]").count()).toBeGreaterThan(0);

  await context.setOffline(true);
  const offlineFetch = await page.evaluate(async (worker) => {
    try {
      await fetch(`${worker}/s/sys_sa?after=1`, { cache: "no-store" });
      return false;
    } catch {
      return true;
    }
  }, WORKER);
  expect(offlineFetch).toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Readoza" })).toBeVisible();
  await channelButton.click();
  await expect(page.locator("[data-post-id]").first()).toBeVisible();
  expect(await page.locator("[data-post-id]").count()).toBeGreaterThan(0);
  await page.screenshot({ path: `${evidenceDir}/live-offline.png`, fullPage: false });
  await context.setOffline(false);
});
