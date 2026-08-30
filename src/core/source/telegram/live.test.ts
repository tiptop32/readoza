import { describe, expect, it } from "vitest";
import { createTelegramPublicSource } from "./source.js";

/**
 * Живая проверка против настоящего Telegram. По умолчанию пропускается: обычный
 * прогон тестов обязан быть офлайновым и детерминированным.
 *
 *   READOZA_LIVE=1 npm test
 *
 * Смысл в том, чтобы гонять её по расписанию (раз в сутки в CI) и узнавать
 * о сломанной вёрстке t.me/s раньше пользователей.
 */
const live = process.env.READOZA_LIVE === "1";

describe.runIf(live)("живой t.me/s", () => {
  const source = createTelegramPublicSource(async (url) => {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.text();
  });

  it("резолвит канал по пользовательскому вводу", async () => {
    const channel = source.match("https://t.me/sys_sa");
    expect(channel).toBe("sys_sa");
    const meta = await source.fetchMeta(channel!);
    expect(meta?.title.length).toBeGreaterThan(0);
    expect(meta?.subscribers).toBeGreaterThan(1000);
  }, 30_000);

  it("находит начало канала и отдаёт курсор вперёд", async () => {
    const page = await source.fetchPage("sys_sa", { kind: "start" });
    expect(page.prev).toBeUndefined(); // начало: назад идти некуда
    expect(page.next).toBeDefined(); // вперёд есть
    expect(page.posts[0]?.id).toBe(1);
    expect(page.channel).toBe("sys_sa");
  }, 30_000);

  it("идёт вперёд по курсору, который отдал сам Telegram", async () => {
    const first = await source.fetchPage("sys_sa", { kind: "start" });
    expect(first.next).toBeDefined();
    const second = await source.fetchPage("sys_sa", first.next!);
    const lastOfFirst = first.posts.at(-1)?.id ?? 0;
    expect(second.posts[0]?.id).toBeGreaterThan(lastOfFirst - 1);
    expect(second.posts.length).toBeGreaterThan(0);
  }, 60_000);
});
