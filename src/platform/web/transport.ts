import type { Transport } from "../../core/source/types.js";

/**
 * Транспорт для браузера.
 *
 * Единственное место во всём приложении, которое отличается между платформами.
 * У t.me нет заголовка Access-Control-Allow-Origin, поэтому web-сборка обязана
 * ходить через собственный прокси. Desktop и mobile будут запрашивать t.me
 * напрямую, подменив только эту функцию.
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
  return async (url) => {
    const response = await fetch(proxyUrl(url, base), { headers: { Accept: "text/html" } });
    if (!response.ok) {
      throw new Error(`${url} -> HTTP ${response.status}`);
    }
    return response.text();
  };
}
