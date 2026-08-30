import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures.js";
import {
  isChannelPage,
  parseChannelPage,
  parseFeed,
  parseFeedChannelMeta,
  parseShortNumber,
  safeUrl,
} from "./parse.js";

const start = fixture("feed-start.html"); // t.me/s/sys_sa?before=20 — начало канала
const mid = fixture("feed-mid.html"); // t.me/s/sys_sa?after=143 — середина
const latest = fixture("feed-latest.html"); // t.me/s/sys_sa — конец канала
const media = fixture("feed-media.html"); // t.me/s/tginfo — много фото
const alias = fixture("feed-alias.html"); // t.me/s/breakingmash — алиас и видео

describe("parseShortNumber", () => {
  it("разбирает сокращения Telegram", () => {
    expect(parseShortNumber("13K")).toBe(13000);
    expect(parseShortNumber("19.1K")).toBe(19100);
    expect(parseShortNumber("1.2M")).toBe(1200000);
    expect(parseShortNumber("19 083")).toBe(19083);
    expect(parseShortNumber("42")).toBe(42);
    expect(parseShortNumber("")).toBeUndefined();
    expect(parseShortNumber("нет")).toBeUndefined();
  });
});

describe("parseFeed: базовая структура", () => {
  it("извлекает посты и канонический канал", () => {
    const page = parseFeed(mid);
    expect(page.channel).toBe("sys_sa");
    expect(page.posts.length).toBeGreaterThan(10);
    for (const post of page.posts) {
      expect(post.channel).toBe("sys_sa");
      expect(post.id).toBeGreaterThan(0);
      expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });

  it("возвращает посты в хронологическом порядке", () => {
    const ids = parseFeed(mid).posts.map((p) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("канонический username берётся из data-post, а не из запрошенного имени", () => {
    // запрошено t.me/s/breakingmash, Telegram отдаёт data-post="mash/..."
    expect(parseFeed(alias).channel).toBe("mash");
  });
});

describe("parseFeed: курсоры", () => {
  it("в середине канала есть оба курсора", () => {
    const page = parseFeed(mid);
    expect(page.prev).toEqual({ kind: "before", id: 144 });
    expect(page.next).toEqual({ kind: "after", id: 168 });
  });

  it("на последней странице нет курсора вперёд — это признак конца канала", () => {
    const page = parseFeed(latest);
    expect(page.next).toBeUndefined();
    expect(page.prev).toEqual({ kind: "before", id: 698 });
  });

  it("на первой странице нет курсора назад — это признак начала канала", () => {
    expect(parseFeed(start).prev).toBeUndefined();
  });
});

describe("parseFeed: пропуски и служебные сообщения", () => {
  it("канал начинается с id 1, при этом id 3 удалён и просто отсутствует", () => {
    const ids = parseFeed(start).posts.map((p) => p.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).not.toContain(3);
  });

  it("помечает служебные сообщения", () => {
    const service = parseFeed(start).posts.filter((p) => p.isService);
    expect(service.length).toBeGreaterThan(0);
    expect(service[0]?.text.length).toBeGreaterThan(0);
  });
});

describe("parseFeed: содержимое поста", () => {
  it("разбирает фото", () => {
    const photos = parseFeed(media).posts.flatMap((p) => p.media).filter((m) => m.kind === "photo");
    expect(photos.length).toBeGreaterThan(5);
    expect(photos[0]?.thumb).toMatch(/^https:\/\/cdn\d+\./);
    expect(photos[0]?.postUrl).toMatch(/^https:\/\/t\.me\//);
  });

  it("разбирает видео", () => {
    const videos = parseFeed(alias).posts.flatMap((p) => p.media).filter((m) => m.kind === "video");
    expect(videos.length).toBeGreaterThan(0);
    expect(videos.some((v) => (v.url ?? "").includes(".mp4"))).toBe(true);
  });

  it("разбирает документы вместе с именем файла и размером", () => {
    const docs = parseFeed(mid).posts.flatMap((p) => p.media).filter((m) => m.kind === "document");
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]?.size).toMatch(/\d+(\.\d+)?\s*(B|KB|MB|GB)/i);
  });

  it("склеивает альбом в один пост со списком id участников", () => {
    const albums = parseFeed(mid).posts.filter((p) => p.albumIds.length > 0);
    expect(albums.length).toBeGreaterThan(0);
    const album = albums[0];
    expect(album?.albumIds.length).toBeGreaterThan(1);
    expect(album?.media.length).toBeGreaterThan(1);
  });

  it("разбирает превью ссылки", () => {
    const previews = parseFeed(mid).posts.map((p) => p.linkPreview).filter(Boolean);
    expect(previews.length).toBeGreaterThan(0);
    expect(previews[0]?.url).toMatch(/^https?:\/\//);
  });

  it("разбирает форварды", () => {
    const fwd = parseFeed(mid).posts.map((p) => p.forwardedFrom).filter(Boolean);
    expect(fwd.length).toBeGreaterThan(0);
    expect(fwd[0]?.name.length).toBeGreaterThan(0);
    expect(fwd[0]?.url).toMatch(/^https:\/\/t\.me\//);
  });

  it("разбирает просмотры и реакции", () => {
    const posts = parseFeed(mid).posts.filter((p) => !p.isService);
    expect(posts.some((p) => (p.views ?? 0) > 0)).toBe(true);
    const reacted = posts.filter((p) => p.reactions.length > 0);
    expect(reacted.length).toBeGreaterThan(0);
    expect(reacted[0]?.reactions[0]?.count).toBeGreaterThan(0);
    expect(reacted[0]?.reactions[0]?.emoji.length).toBeGreaterThan(0);
  });

  it("не подменяет текст поста текстом цитируемого сообщения", () => {
    for (const post of parseFeed(latest).posts) {
      expect(post.html).not.toContain("tgme_widget_message_reply");
    }
  });
});

describe("parseFeed: длинные посты не обрезаются", () => {
  // Регрессия на эксперимент E-1: t.me/s отдаёт полный текст поста.
  // Если Telegram когда-нибудь начнёт обрезать превью, этот тест упадёт первым.
  it("в ленте встречаются посты длиннее 4000 символов", () => {
    const longest = Math.max(...parseFeed(latest).posts.map((p) => p.text.length));
    expect(longest).toBeGreaterThan(4000);
  });

  it("тексты постов не оканчиваются многоточием обрезки", () => {
    const truncated = parseFeed(latest).posts.filter((p) => /[…]\s*$/.test(p.text) && p.text.length > 500);
    expect(truncated).toHaveLength(0);
  });
});

describe("safeUrl", () => {
  it("пропускает обычные адреса и достраивает протокол-относительные", () => {
    expect(safeUrl("https://cdn4.telesco.pe/file/x.jpg")).toBe("https://cdn4.telesco.pe/file/x.jpg");
    expect(safeUrl("https://t.me/sys_sa/1")).toBe("https://t.me/sys_sa/1");
    expect(safeUrl("//telegram.org/img/emoji/40/x.png")).toBe(
      "https://telegram.org/img/emoji/40/x.png",
    );
  });

  it("отбрасывает всё, что не http и не https", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)  ",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "",
      undefined,
      null,
    ]) {
      expect(safeUrl(bad), String(bad)).toBeUndefined();
    }
  });
});

describe("parseFeed: адреса из чужой разметки", () => {
  // Санитайзер прикрывает только текст поста. Ссылки на медиа, превью и форварды
  // попадают прямо в href и src, поэтому чистятся на границе разбора.
  const hostile = `<div class="tgme_widget_message" data-post="evil/1">
    <div class="tgme_widget_message_forwarded_from"><a class="tgme_widget_message_forwarded_from_name" href="javascript:alert(1)"><span>Злой канал</span></a></div>
    <a class="tgme_widget_message_photo_wrap" href="javascript:alert(2)" style="background-image:url('javascript:alert(3)')"></a>
    <a class="tgme_widget_message_link_preview" href="javascript:alert(4)"><div class="link_preview_title">заголовок</div></a>
    <div class="tgme_widget_message_text js-message_text">текст</div>
    <a class="tgme_widget_message_date" href="https://t.me/evil/1"><time datetime="2021-08-05T10:00:00+00:00">10:00</time></a>
  </div>`;

  const post = parseFeed(hostile).posts[0];

  it("не пропускает javascript: в ссылку форварда", () => {
    expect(post?.forwardedFrom?.name).toBe("Злой канал");
    expect(post?.forwardedFrom?.url).toBeUndefined();
  });

  it("не пропускает javascript: в медиа", () => {
    expect(post?.media[0]?.postUrl).toBeUndefined();
    expect(post?.media[0]?.thumb).toBeUndefined();
  });

  it("выбрасывает превью ссылки целиком, если адрес небезопасен", () => {
    expect(post?.linkPreview).toBeUndefined();
  });
});

describe("parseFeedChannelMeta", () => {
  it("читает шапку канала со страницы ленты", () => {
    const meta = parseFeedChannelMeta(latest);
    expect(meta?.username).toBe("sys_sa");
    expect(meta?.title.length).toBeGreaterThan(0);
    expect(meta?.subscribers).toBeGreaterThan(1000);
    expect(meta?.description?.length).toBeGreaterThan(0);
  });
});

describe("parseChannelPage: резолвер строки ввода", () => {
  it("возвращает карточку существующего канала", () => {
    const meta = parseChannelPage(fixture("channel-page.html"));
    expect(meta?.username).toBe("sys_sa");
    expect(meta?.title).toBe("Системный Аналитик");
    expect(meta?.subscribers).toBeGreaterThan(1000);
    expect(meta?.avatar).toMatch(/^https:\/\//);
  });

  it("возвращает null для несуществующего канала", () => {
    expect(parseChannelPage(fixture("channel-missing.html"))).toBeNull();
  });

  it("алиас на странице канала не разворачивается", () => {
    // t.me/breakingmash отдаёт настоящее название, но прежний username.
    // Канонический username берётся только из data-post при загрузке ленты.
    const meta = parseChannelPage(fixture("channel-alias.html"));
    expect(meta?.username).toBe("breakingmash");
    expect(meta?.title).toBe("Mash");
  });

  it("отличает канал от группы", () => {
    expect(isChannelPage(fixture("channel-page.html"))).toBe(true);
    expect(isChannelPage(fixture("channel-group.html"))).toBe(false);
  });
});
