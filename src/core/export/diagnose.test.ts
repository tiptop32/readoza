import { describe, expect, it } from "vitest";
import { sanitizePostHtml } from "../../ui/sanitize.js";
import { fixture } from "../source/telegram/fixtures.js";
import { parseFeed } from "../source/telegram/parse.js";
import type { Channel } from "../storage/types.js";
import { buildEpub } from "./epub.js";

const channel: Channel = {
  id: "telegram-public:sys_sa",
  source: "telegram-public",
  username: "sys_sa",
  title: "Системный Аналитик",
  importState: "complete",
  addedAt: "2026-08-30T12:00:00.000Z",
};

/**
 * Книга обязана содержать всё, что лежит в хранилище. Единственное, что она
 * отбрасывает намеренно, — служебные сообщения вроде «канал создан».
 * Если книга окажется неполной, причина должна быть в неполной докачке,
 * а не в тихой потере постов здесь.
 */
describe("экспорт не теряет посты", () => {
  const posts = ["feed-start.html", "feed-mid.html", "feed-latest.html", "feed-media.html"].flatMap(
    (name) => parseFeed(fixture(name)).posts,
  );

  it("переносит в книгу всё, кроме служебных сообщений", () => {
    const service = posts.filter((post) => post.isService).length;
    const book = buildEpub(channel, posts, sanitizePostHtml, {
      now: new Date("2026-08-30T12:00:00.000Z"),
    });

    expect(service).toBeGreaterThan(0); // иначе проверка ничего не проверяет
    expect(book.posts).toBe(posts.length - service);
  });

  it("не теряет посты без текста: у них может быть медиа или превью", () => {
    const silent = posts.filter((post) => !post.isService && !post.text);
    expect(silent.length).toBeGreaterThan(0);

    const book = buildEpub(channel, silent, sanitizePostHtml, {
      now: new Date("2026-08-30T12:00:00.000Z"),
    });
    expect(book.posts).toBe(silent.length);
  });
});
