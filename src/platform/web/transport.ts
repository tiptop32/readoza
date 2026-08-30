import type { Transport } from "../../core/source/types.js";
import { type FetchLike, readHtml } from "../http.js";

/**
 * Транспорт для браузера.
 *
 * У t.me нет заголовка Access-Control-Allow-Origin, поэтому web-сборка обязана
 * ходить через собственный прокси. Desktop этого не делает: см. desktop/transport.ts.
 *
 * Прокси остаётся тупым: получить HTML, отдать HTML. Он не хранит ни постов,
 * ни истории чтения и не должен знать, кто что читает.
 */

const TELEGRAM_ORIGIN = "https://t.me";

/** Базовый путь прокси. В разработке его обслуживает сам Vite, см. vite.config.ts. */
const PROXY_BASE: string = import.meta.env.VITE_TG_PROXY ?? "/tg";

export function proxyUrl(url: string, base: string = PROXY_BASE): string {
  return url.startsWith(TELEGRAM_ORIGIN) ? base + url.slice(TELEGRAM_ORIGIN.length) : url;
}

export function createWebTransport(base: string = PROXY_BASE): Transport {
  return (url) =>
    // User-Agent в браузере запрещён к установке, поэтому его здесь нет.
    readHtml(fetch as unknown as FetchLike, url, { requestUrl: proxyUrl(url, base) });
}
