/**
 * Парсер публичного HTML Telegram (t.me/s/<channel> и t.me/<channel>).
 *
 * ВСЯ хрупкость проекта живёт в этом файле. t.me/s не является документированным
 * API, вёрстка может измениться в любой момент. Поэтому:
 *   - здесь нет ни одной зависимости, только DOMParser (есть во всех webview);
 *   - функции чистые: строка на входе, структура на выходе, никакой сети;
 *   - каждая конструкция закреплена golden-тестом на реальном HTML в __fixtures__/.
 *
 * Когда Telegram сломает вёрстку, падает parse.test.ts и правится только этот файл.
 */

import type {
  ChannelMeta,
  Cursor,
  ForwardedFrom,
  LinkPreview,
  Media,
  Page,
  Post,
  Reaction,
} from "../../model.js";

const BG_URL = /background-image\s*:\s*url\(['"]?(.*?)['"]?\)/i;
const SINGLE_ID = /\/(\d+)\?single/;
const TRAILING_COUNT = /([\d.,\s ]+[KMkm]?)\s*$/;

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/ /g, " ").trim();
}

function bgUrl(el: Element | null | undefined): string | undefined {
  const style = el?.getAttribute("style");
  const m = style ? BG_URL.exec(style) : null;
  return m?.[1] ?? undefined;
}

/** «13K» -> 13000, «1.2M» -> 1200000, «19 083» -> 19083. */
export function parseShortNumber(raw: string): number | undefined {
  const s = raw.replace(/[\s ]/g, "").replace(",", ".");
  const m = /^([\d.]+)([KMkm]?)$/.exec(s);
  if (!m?.[1]) return undefined;
  const n = Number.parseFloat(m[1]);
  if (Number.isNaN(n)) return undefined;
  const mult = m[2]?.toLowerCase() === "m" ? 1e6 : m[2]?.toLowerCase() === "k" ? 1e3 : 1;
  return Math.round(n * mult);
}

/**
 * Текстовый блок поста. Внутри ответа на сообщение лежит свой .tgme_widget_message_text,
 * его надо пропустить, иначе текст ответа подменит собой текст поста.
 */
function bodyElement(root: Element): Element | undefined {
  for (const el of root.querySelectorAll(".tgme_widget_message_text")) {
    if (!el.closest(".tgme_widget_message_reply")) return el;
  }
  return undefined;
}

function parseMedia(root: Element): Media[] {
  const media: Media[] = [];

  for (const el of root.querySelectorAll("a.tgme_widget_message_photo_wrap")) {
    media.push({
      kind: "photo",
      thumb: bgUrl(el),
      postUrl: el.getAttribute("href") ?? undefined,
    });
  }

  for (const el of root.querySelectorAll(".tgme_widget_message_video_wrap")) {
    const video = el.querySelector("video");
    const player = el.closest(".tgme_widget_message_video_player")
      ?? el.parentElement?.querySelector("a.tgme_widget_message_video_player");
    media.push({
      kind: "video",
      url: video?.getAttribute("src") ?? undefined,
      thumb: bgUrl(el.querySelector(".tgme_widget_message_video_thumb")),
      postUrl: player?.getAttribute("href") ?? undefined,
    });
  }

  for (const el of root.querySelectorAll("a.tgme_widget_message_document_wrap")) {
    media.push({
      kind: "document",
      title: text(el.querySelector(".tgme_widget_message_document_title")) || undefined,
      size: text(el.querySelector(".tgme_widget_message_document_extra")) || undefined,
      postUrl: el.getAttribute("href") ?? undefined,
    });
  }

  return media;
}

/**
 * Альбом приходит одним блоком с одним data-post, но каждая картинка внутри ссылается
 * на собственный message id вида /channel/123?single. Без этого один альбом
 * выглядит как несколько независимых постов или, наоборот, теряет часть картинок.
 */
function parseAlbumIds(root: Element): number[] {
  if (!root.querySelector(".tgme_widget_message_grouped_wrap")) return [];
  const ids = new Set<number>();
  for (const a of root.querySelectorAll(".tgme_widget_message_grouped_wrap a[href]")) {
    const m = SINGLE_ID.exec(a.getAttribute("href") ?? "");
    if (m?.[1]) ids.add(Number.parseInt(m[1], 10));
  }
  return [...ids].sort((a, b) => a - b);
}

function parseLinkPreview(root: Element): LinkPreview | undefined {
  const el = root.querySelector("a.tgme_widget_message_link_preview");
  const url = el?.getAttribute("href");
  if (!el || !url) return undefined;
  const preview: LinkPreview = { url };
  const site = text(el.querySelector(".link_preview_site_name")) || undefined;
  const title = text(el.querySelector(".link_preview_title")) || undefined;
  const description = text(el.querySelector(".link_preview_description")) || undefined;
  const image = bgUrl(el.querySelector(".link_preview_image"))
    ?? bgUrl(el.querySelector(".link_preview_right_image"));
  if (site) preview.siteName = site;
  if (title) preview.title = title;
  if (description) preview.description = description;
  if (image) preview.image = image;
  return preview;
}

function parseForwardedFrom(root: Element): ForwardedFrom | undefined {
  const holder = root.querySelector(".tgme_widget_message_forwarded_from");
  if (!holder) return undefined;
  const link = holder.querySelector("a.tgme_widget_message_forwarded_from_name");
  const name = text(link) || text(holder).replace(/^Forwarded from\s*/i, "");
  if (!name) return undefined;
  const url = link?.getAttribute("href");
  return url ? { name, url } : { name };
}

function parseReactions(root: Element): Reaction[] {
  const out: Reaction[] = [];
  for (const el of root.querySelectorAll(".tgme_widget_message_reactions .tgme_reaction")) {
    const emoji = text(el.querySelector("b")) || text(el.querySelector("i"));
    const m = TRAILING_COUNT.exec(text(el));
    const count = m?.[1] ? parseShortNumber(m[1]) : undefined;
    if (emoji && count !== undefined) out.push({ emoji, count });
  }
  return out;
}

function parsePost(el: Element): Post | null {
  const dataPost = el.getAttribute("data-post");
  const m = dataPost ? /^(.+)\/(\d+)$/.exec(dataPost) : null;
  if (!m?.[1] || !m[2]) return null;

  const body = bodyElement(el);
  const time = el.querySelector(".tgme_widget_message_date time")?.getAttribute("datetime");
  const views = text(el.querySelector(".tgme_widget_message_views"));

  const post: Post = {
    channel: m[1],
    id: Number.parseInt(m[2], 10),
    date: time ?? "",
    html: body?.innerHTML ?? "",
    text: text(body),
    media: parseMedia(el),
    albumIds: parseAlbumIds(el),
    isService: el.classList.contains("service_message"),
    reactions: parseReactions(el),
  };

  const linkPreview = parseLinkPreview(el);
  if (linkPreview) post.linkPreview = linkPreview;
  const forwardedFrom = parseForwardedFrom(el);
  if (forwardedFrom) post.forwardedFrom = forwardedFrom;
  const viewCount = views ? parseShortNumber(views) : undefined;
  if (viewCount !== undefined) post.views = viewCount;

  return post;
}

/**
 * Курсор из ссылки «показать ещё», которую рисует сам Telegram.
 * Курсоры не вычисляются нами: их отсутствие и есть признак края канала.
 */
function moreCursor(doc: Document, kind: "before" | "after"): Cursor | undefined {
  const el = doc.querySelector(`a.js-messages_more[data-${kind}]`);
  const raw = el?.getAttribute(`data-${kind}`);
  if (!raw) return undefined;
  const id = Number.parseInt(raw, 10);
  return Number.isNaN(id) ? undefined : { kind, id };
}

/** Разбирает страницу ленты t.me/s/<channel>. */
export function parseFeed(html: string): Page {
  const doc = parse(html);
  const posts: Post[] = [];
  for (const el of doc.querySelectorAll(".tgme_widget_message[data-post]")) {
    const post = parsePost(el);
    if (post) posts.push(post);
  }
  posts.sort((a, b) => a.id - b.id);

  const headerUsername = text(doc.querySelector(".tgme_channel_info_header_username a"))
    .replace(/^@/, "");
  const page: Page = {
    channel: posts[0]?.channel ?? headerUsername,
    posts,
  };
  const prev = moreCursor(doc, "before");
  const next = moreCursor(doc, "after");
  if (prev) page.prev = prev;
  if (next) page.next = next;
  return page;
}

/** Шапка канала со страницы ленты t.me/s/<channel>. */
export function parseFeedChannelMeta(html: string): ChannelMeta | null {
  const doc = parse(html);
  const title = text(doc.querySelector(".tgme_channel_info_header_title"));
  const username = text(doc.querySelector(".tgme_channel_info_header_username a")).replace(/^@/, "");
  if (!title || !username) return null;

  const meta: ChannelMeta = { username, title };
  const description = text(doc.querySelector(".tgme_channel_info_description"));
  if (description) meta.description = description;
  const avatar = doc.querySelector(".tgme_page_photo_image img, .tgme_channel_info_header_photo img")
    ?.getAttribute("src");
  if (avatar) meta.avatar = avatar;

  for (const counter of doc.querySelectorAll(".tgme_channel_info_counter")) {
    if (text(counter.querySelector(".counter_type")) !== "subscribers") continue;
    const n = parseShortNumber(text(counter.querySelector(".counter_value")));
    if (n !== undefined) meta.subscribers = n;
  }
  return meta;
}

/**
 * Карточка канала со страницы t.me/<channel>. Один дешёвый запрос (~11 KB) вместо
 * загрузки ленты — это резолвер для строки ввода.
 *
 * Возвращает null, если канала не существует: у несуществующего имени og:title
 * выглядит как «Telegram: Contact @name».
 */
export function parseChannelPage(html: string): ChannelMeta | null {
  const doc = parse(html);
  const og = (p: string) =>
    doc.querySelector(`meta[property="og:${p}"]`)?.getAttribute("content") ?? "";

  const title = og("title");
  if (!title || /^Telegram:\s*Contact\s*@/i.test(title)) return null;

  // og:url на этой странице нет. Username лежит в app-link для мобильных клиентов.
  // Внимание: алиасы здесь НЕ разворачиваются (t.me/breakingmash -> breakingmash),
  // канонический username появляется только из data-post при первой загрузке ленты.
  const appLink = doc.querySelector('meta[property="al:android:url"], meta[property="al:ios:url"]')
    ?.getAttribute("content") ?? "";
  const username = /domain=([A-Za-z0-9_]+)/.exec(appLink)?.[1];
  if (!username) return null;

  const meta: ChannelMeta = { username, title };
  const description = og("description");
  if (description) meta.description = description;
  const avatar = og("image");
  if (avatar) meta.avatar = avatar;

  // «19 083 subscribers» у канала против «1 293 members» у группы.
  const extra = text(doc.querySelector(".tgme_page_extra"));
  const subs = /^([\d\s .,KM]+)\s*subscribers/i.exec(extra);
  if (subs?.[1]) {
    const n = parseShortNumber(subs[1]);
    if (n !== undefined) meta.subscribers = n;
  }
  return meta;
}

/** Группа или пользователь, а не канал: у таких нет ленты в t.me/s. */
export function isChannelPage(html: string): boolean {
  const doc = parse(html);
  return /subscribers/i.test(text(doc.querySelector(".tgme_page_extra")));
}
