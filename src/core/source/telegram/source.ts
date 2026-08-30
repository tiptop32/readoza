import type { ChannelMeta, Cursor, Page } from "../../model.js";
import type { Source, Transport } from "../types.js";
import { parseChannelPage, parseFeed, parseFeedChannelMeta } from "./parse.js";

export const TELEGRAM_PUBLIC = "telegram-public";

const BASE = "https://t.me";

/** Пути t.me, которые не являются каналами. */
const RESERVED = new Set([
  "s", "c", "joinchat", "addstickers", "addtheme", "addemoji",
  "proxy", "socks", "share", "iv", "login", "setlanguage", "confirmphone",
]);

/**
 * Приводит любой пользовательский ввод к username канала.
 * Принимает: https://t.me/name, t.me/s/name, t.me/name/123, @name, name,
 * tg://resolve?domain=name. Возвращает null, если это не похоже на публичный канал.
 */
export function parseChannelInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  let candidate = raw;
  const deepLink = /^tg:\/\/resolve\?.*\bdomain=([A-Za-z0-9_]+)/i.exec(raw);
  if (deepLink?.[1]) {
    candidate = deepLink[1];
  } else if (/t\.me\//i.test(raw)) {
    const path = raw.replace(/^.*t\.me\//i, "").replace(/^s\//i, "");
    candidate = path.split(/[/?#]/)[0] ?? "";
  }

  candidate = candidate.replace(/^@/, "");
  // Приватные приглашения (t.me/+abc, t.me/joinchat/abc) публично не читаются.
  if (candidate.startsWith("+")) return null;
  if (!/^[A-Za-z0-9_]{4,32}$/.test(candidate)) return null;
  if (RESERVED.has(candidate.toLowerCase())) return null;
  return candidate;
}

/**
 * Пробы для поиска начала канала: наименьшее N, при котором ?before=N отдаёт хоть
 * что-то. Обычно хватает первой: если пост 1 жив, ?before=2 сразу его возвращает.
 * Пробы нужны для каналов, у которых первые сотни id удалены.
 */
const START_PROBES = [2, 20, 200, 2000, 20000, 200000] as const;

/**
 * URL ленты для курсора.
 *
 * Внимание: ?after=0 использовать НЕЛЬЗЯ. Telegram молча игнорирует нулевой курсор
 * и отдаёт последнюю страницу канала вместо первой (проверено на sys_sa, durov,
 * tginfo, mash). Начало ищется только через ?before=N.
 */
export function feedUrl(channel: string, cursor: Cursor): string {
  const base = `${BASE}/s/${channel}`;
  switch (cursor.kind) {
    case "start":
      return `${base}?before=${START_PROBES[0]}`;
    case "end":
      return base;
    case "before":
      return `${base}?before=${cursor.id}`;
    case "after":
      return `${base}?after=${cursor.id}`;
  }
}

export function channelUrl(channel: string): string {
  return `${BASE}/${channel}`;
}

/**
 * Источник поверх публичного HTML Telegram. Про сеть знает только через transport,
 * поэтому один и тот же экземпляр работает и в браузере через прокси,
 * и в desktop/mobile напрямую.
 */
export function createTelegramPublicSource(transport: Transport): Source {
  return {
    id: TELEGRAM_PUBLIC,

    match(input: string): string | null {
      return parseChannelInput(input);
    },

    async fetchMeta(channel: string): Promise<ChannelMeta | null> {
      return parseChannelPage(await transport(channelUrl(channel)));
    },

    async fetchPage(channel: string, cursor: Cursor): Promise<Page> {
      if (cursor.kind === "start") return fetchStart(transport, channel);
      return parseFeed(await transport(feedUrl(channel, cursor)));
    },
  };
}

/**
 * Первое окно канала. Расширяет пробу, пока страница не окажется непустой:
 * у канала, где удалены первые сотни сообщений, ?before=2 отдаёт пустую ленту.
 * Признак начала — отсутствие курсора назад, его проверяет уже вызывающий код.
 */
async function fetchStart(transport: Transport, channel: string): Promise<Page> {
  let page: Page = { channel, posts: [] };
  for (const before of START_PROBES) {
    page = parseFeed(await transport(feedUrl(channel, { kind: "before", id: before })));
    if (page.posts.length > 0) return page;
  }
  return page;
}

export { parseFeedChannelMeta };
