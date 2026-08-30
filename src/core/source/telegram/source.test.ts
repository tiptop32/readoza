import { describe, expect, it } from "vitest";
import type { Transport } from "../types.js";
import { fixture } from "./fixtures.js";
import { createTelegramPublicSource, feedUrl, parseChannelInput } from "./source.js";

describe("parseChannelInput", () => {
  it("принимает все формы ссылки на канал", () => {
    for (const input of [
      "https://t.me/sys_sa",
      "http://t.me/sys_sa",
      "t.me/sys_sa",
      "https://t.me/s/sys_sa",
      "https://t.me/sys_sa/123",
      "https://t.me/sys_sa?before=20",
      "tg://resolve?domain=sys_sa",
      "@sys_sa",
      "sys_sa",
      "  sys_sa  ",
    ]) {
      expect(parseChannelInput(input), input).toBe("sys_sa");
    }
  });

  it("отклоняет то, что не является публичным каналом", () => {
    for (const input of [
      "",
      "   ",
      "ab",
      "https://t.me/+AbCdEf",
      "https://t.me/joinchat/AbCdEf",
      "https://t.me/c/1234567/89",
      "https://example.com/sys_sa",
      "@очень русский",
      "name-with-dash",
    ]) {
      expect(parseChannelInput(input), input).toBeNull();
    }
  });
});

describe("feedUrl", () => {
  it("строит URL для каждого курсора", () => {
    expect(feedUrl("sys_sa", { kind: "end" })).toBe("https://t.me/s/sys_sa");
    expect(feedUrl("sys_sa", { kind: "start" })).toBe("https://t.me/s/sys_sa?before=2");
    expect(feedUrl("sys_sa", { kind: "after", id: 143 })).toBe("https://t.me/s/sys_sa?after=143");
    expect(feedUrl("sys_sa", { kind: "before", id: 20 })).toBe("https://t.me/s/sys_sa?before=20");
  });
});

describe("createTelegramPublicSource", () => {
  const transport = (byUrl: Record<string, string>): Transport => async (url) => {
    const body = byUrl[url];
    if (body === undefined) throw new Error(`неожиданный URL: ${url}`);
    return body;
  };

  it("ходит в сеть только через transport", async () => {
    const seen: string[] = [];
    const source = createTelegramPublicSource(async (url) => {
      seen.push(url);
      return fixture("feed-mid.html");
    });
    await source.fetchPage("sys_sa", { kind: "after", id: 143 });
    expect(seen).toEqual(["https://t.me/s/sys_sa?after=143"]);
  });

  it("отдаёт страницу с постами и курсорами", async () => {
    const source = createTelegramPublicSource(
      transport({ "https://t.me/s/sys_sa?after=143": fixture("feed-mid.html") }),
    );
    const page = await source.fetchPage("sys_sa", { kind: "after", id: 143 });
    expect(page.channel).toBe("sys_sa");
    expect(page.posts.length).toBeGreaterThan(10);
    expect(page.next).toEqual({ kind: "after", id: 168 });
  });

  it("начало канала берётся первой же пробой, если пост 1 жив", async () => {
    const seen: string[] = [];
    const source = createTelegramPublicSource(async (url) => {
      seen.push(url);
      return fixture("feed-start.html");
    });
    const page = await source.fetchPage("sys_sa", { kind: "start" });
    expect(seen).toEqual(["https://t.me/s/sys_sa?before=2"]);
    expect(page.posts[0]?.id).toBe(1);
    expect(page.prev).toBeUndefined();
  });

  it("расширяет пробу, если первые сообщения канала удалены", async () => {
    // канал, у которого ?before=2 отдаёт пустую ленту
    const seen: string[] = [];
    const source = createTelegramPublicSource(async (url) => {
      seen.push(url);
      return url.endsWith("?before=2") ? "<html><body></body></html>" : fixture("feed-start.html");
    });
    const page = await source.fetchPage("sys_sa", { kind: "start" });
    expect(seen).toEqual([
      "https://t.me/s/sys_sa?before=2",
      "https://t.me/s/sys_sa?before=20",
    ]);
    expect(page.posts.length).toBeGreaterThan(0);
  });

  it("не зацикливается на канале без единого поста", async () => {
    const seen: string[] = [];
    const source = createTelegramPublicSource(async (url) => {
      seen.push(url);
      return "<html><body></body></html>";
    });
    const page = await source.fetchPage("sys_sa", { kind: "start" });
    expect(page.posts).toHaveLength(0);
    expect(seen.length).toBeLessThanOrEqual(6);
  });

  it("резолвит канал одним дешёвым запросом", async () => {
    const source = createTelegramPublicSource(
      transport({ "https://t.me/sys_sa": fixture("channel-page.html") }),
    );
    const meta = await source.fetchMeta("sys_sa");
    expect(meta?.username).toBe("sys_sa");
    expect(meta?.subscribers).toBeGreaterThan(1000);
  });

  it("отдаёт null для несуществующего канала", async () => {
    const source = createTelegramPublicSource(
      transport({ "https://t.me/nosuchchannel": fixture("channel-missing.html") }),
    );
    expect(await source.fetchMeta("nosuchchannel")).toBeNull();
  });
});
