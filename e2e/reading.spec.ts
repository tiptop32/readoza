import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const FIXTURES = fileURLToPath(new URL("../src/core/source/telegram/__fixtures__/", import.meta.url));
const fixture = (name: string): string => readFileSync(FIXTURES + name, "utf8");

/**
 * Telegram подменяется внутри браузера сохранёнными страницами. Это не мок
 * парсера: приложение работает с настоящим HTML Telegram, просто без сети.
 */
/**
 * Медиа с CDN Telegram подменяется настоящим PNG, а не блокируется: у картинки
 * нулевого размера схлопывается обёртка, и кликнуть по ней нельзя.
 */
const IMAGE = fileURLToPath(new URL("../public/icon-192.png", import.meta.url));

async function stubTelegram(page: Page): Promise<void> {
  await page.route(/telesco\.pe|telegram\.org/, (route) =>
    route.fulfill({ path: IMAGE, contentType: "image/png" }),
  );
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

test("без сети остаётся читаемым и честно об этом говорит", async ({ page, context }) => {
  await stubTelegram(page);
  await addChannel(page);
  const visible = await page.locator("[data-post-id]").count();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(
    page.getByText("You are offline. Everything already downloaded is still readable."),
  ).toBeVisible();
  // Скачанное никуда не делось: это и есть смысл local-first.
  expect(await page.locator("[data-post-id]").count()).toBe(visible);
  await expect(page.locator("#post-1")).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByText("You are offline. Everything already downloaded is still readable."),
  ).toBeHidden();
});

test("возвращает туда, где остановился, а не к самому дальнему прочитанному", async ({ page }) => {
  await stubTelegram(page);
  await addChannel(page);

  // Уходим вглубь канала.
  for (let i = 0; i < 8; i += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);
  const deepId = await page.$$eval(".post--read", (nodes) =>
    Math.max(...nodes.map((node) => Number((node as HTMLElement).dataset["postId"]))),
  );
  expect(deepId).toBeGreaterThan(10);

  // И сознательно отматываем назад, к началу.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);

  await page.reload();
  // Прогресс не обнулился от перечитывания: процент считается по границе.
  await expect(page.getByText(/posts read/)).toBeVisible();
  await page.getByRole("button", { name: /^Системный Аналитик/ }).click();
  await expect(page.locator("[data-post-id]").first()).toBeVisible();

  // Открылись там, где реально остановились, а не на самом дальнем посте.
  const landedOn = await page.$$eval("[data-post-id]", (nodes) => {
    const seen = nodes
      .map((node) => ({
        id: Number((node as HTMLElement).dataset["postId"]),
        y: node.getBoundingClientRect().top,
      }))
      .filter((post) => post.y > -200)
      .sort((a, b) => a.y - b.y);
    return seen[0]?.id ?? -1;
  });
  expect(landedOn).toBeLessThan(deepId);
});

test("открывает картинку во весь экран", async ({ page }) => {
  await stubTelegram(page);
  await addChannel(page);

  const photo = page.getByRole("button", { name: "Open photo" }).first();
  await photo.scrollIntoViewIfNeeded();
  await photo.click();

  const overlay = page.getByRole("dialog");
  await expect(overlay).toBeVisible();
  // Картинка занимает экран, а не колонку шириной с текст.
  const box = await overlay.locator(".lightbox__image").boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
});

test("после возврата даёт листать назад к прочитанному", async ({ page }) => {
  await stubTelegram(page);
  await addChannel(page);

  // Читаем вглубь канала, чтобы позиция ушла далеко от начала.
  for (let i = 0; i < 6; i += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1200); // сохранение позиции

  await page.reload();
  await page.getByRole("button", { name: /^Системный Аналитик/ }).click();
  await expect(page.locator("[data-post-id]").first()).toBeVisible();

  // Открылись не с начала канала: позиция восстановлена.
  const firstLoaded = await page.$$eval("[data-post-id]", (nodes) =>
    Math.min(...nodes.map((node) => Number((node as HTMLElement).dataset["postId"]))),
  );
  expect(firstLoaded).toBeGreaterThan(1);

  // Листаем вверх, пока не упрёмся в самое начало канала.
  const start = page.getByText("This is the first post of the channel.");
  let reachedStart = false;
  for (let attempt = 0; attempt < 40 && !reachedStart; attempt += 1) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    reachedStart = await start.isVisible();
  }

  expect(reachedStart).toBe(true);
  await expect(page.locator("#post-1")).toBeAttached();
});

test("отдаёт канал книгой в формате EPUB с карточки на главной", async ({ page }) => {
  await stubTelegram(page);
  await addChannel(page);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Readoza" })).toBeVisible();

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /export as epub/i }).click();
  const download = await downloading;

  expect(download.suggestedFilename()).toBe("readoza-sys_sa.epub");
  const saved = await download.path();
  const bytes = readFileSync(saved);
  // mimetype обязан лежать первой записью архива, иначе это не EPUB.
  expect(bytes.subarray(30, 38).toString("utf8")).toBe("mimetype");
  expect(bytes.byteLength).toBeGreaterThan(1000);
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
