import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const FIXTURES = fileURLToPath(new URL("../src/core/source/telegram/__fixtures__/", import.meta.url));
const fixture = (name: string): string => readFileSync(FIXTURES + name, "utf8");

/**
 * Telegram подменяется внутри браузера сохранёнными страницами. Это не мок
 * парсера: приложение работает с настоящим HTML Telegram, просто без сети.
 */
async function stubTelegram(page: Page): Promise<void> {
  await page.route(/telesco\.pe|telegram\.org/, (route) => route.abort());
  await page.route("**/tg/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/tg/, "");
    const after = url.searchParams.get("after");

    let body: string;
    if (!path.startsWith("/s/")) {
      body = fixture("channel-page.html"); // карточка канала
    } else if (url.searchParams.has("before")) {
      body = fixture("feed-start.html"); // начало канала
    } else if (after !== null) {
      body = Number(after) < 100 ? fixture("feed-mid.html") : fixture("feed-latest.html");
    } else {
      body = fixture("feed-latest.html"); // последняя страница
    }
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
  });
}

async function addChannel(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Telegram channel").fill("t.me/sys_sa");
  await page.getByRole("button", { name: /start from the beginning/i }).click();
  await expect(page.locator("#post-1")).toBeVisible();
}

test("открывает канал с самого первого поста", async ({ page }) => {
  await stubTelegram(page);
  await addChannel(page);

  const ids = await page.$$eval("[data-post-id]", (nodes) =>
    nodes.map((node) => Number((node as HTMLElement).dataset["postId"])),
  );
  expect(ids[0]).toBe(1);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
  await expect(page.locator(".reader__title b")).toHaveText("Системный Аналитик");
});

test("запоминает позицию при прокрутке и возвращает на неё после перезагрузки", async ({ page }) => {
  await stubTelegram(page);
  await addChannel(page);

  // Прокручиваем по-настоящему: именно здесь работает IntersectionObserver,
  // которого нет в jsdom.
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1200); // задержка сохранения позиции

  const readId = await page.$$eval(".post--read", (nodes) =>
    Math.max(...nodes.map((node) => Number((node as HTMLElement).dataset["postId"]))),
  );
  expect(readId).toBeGreaterThan(1);
  await expect(page.locator(".reader__percent")).not.toHaveText("0%");

  await page.reload();

  // После перезагрузки канал лежит в списке с ненулевым прогрессом.
  await expect(page.getByRole("heading", { name: "Readoza" })).toBeVisible();
  await expect(page.getByText(/posts read/)).toBeVisible();

  await page.getByRole("button", { name: /^Системный Аналитик/ }).click();

  // Читалка вернулась ровно на сохранённый пост, а не в начало канала.
  await expect(page.locator(`#post-${readId}`)).toBeVisible();
  const box = await page.locator(`#post-${readId}`).boundingBox();
  expect(box).not.toBeNull();
  expect(box?.y ?? 9999).toBeLessThan(400);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
});

test("дочитывает канал до конца и подгружает новые окна", async ({ page }) => {
  await stubTelegram(page);
  await addChannel(page);

  const before = await page.locator("[data-post-id]").count();
  const end = page.getByText("You have reached the end of the channel.");

  // Лента растёт по мере прокрутки, поэтому фиксированное число шагов до низа не
  // доезжает. Крутим до конца документа, пока конец канала не покажется сам.
  let reachedEnd = false;
  for (let attempt = 0; attempt < 40 && !reachedEnd; attempt += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(350);
    reachedEnd = await end.isVisible();
  }

  expect(reachedEnd).toBe(true);
  expect(await page.locator("[data-post-id]").count()).toBeGreaterThan(before);
});
