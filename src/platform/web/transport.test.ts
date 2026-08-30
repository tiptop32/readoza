import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebTransport, proxyUrl } from "./transport.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proxyUrl", () => {
  it("подменяет origin Telegram на путь прокси", () => {
    expect(proxyUrl("https://t.me/s/sys_sa?after=143", "/tg")).toBe("/tg/s/sys_sa?after=143");
    expect(proxyUrl("https://t.me/sys_sa", "/tg")).toBe("/tg/sys_sa");
  });

  it("работает с абсолютным адресом прокси", () => {
    expect(proxyUrl("https://t.me/s/sys_sa", "https://proxy.example/tg")).toBe(
      "https://proxy.example/tg/s/sys_sa",
    );
  });

  it("не трогает посторонние адреса", () => {
    expect(proxyUrl("https://example.com/x", "/tg")).toBe("https://example.com/x");
  });
});

describe("createWebTransport", () => {
  it("ходит через прокси и отдаёт тело ответа", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "<html>" });
    vi.stubGlobal("fetch", fetchMock);

    const transport = createWebTransport("/tg");
    expect(await transport("https://t.me/s/sys_sa")).toBe("<html>");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/tg/s/sys_sa");
  });

  it("превращает не-200 в ошибку, а не в пустую страницу", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "" }));
    const transport = createWebTransport("/tg");
    await expect(transport("https://t.me/s/sys_sa")).rejects.toThrow(/429/);
  });
});
