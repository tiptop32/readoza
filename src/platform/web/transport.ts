import { TransportError } from "../../core/source/errors.js";
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
    let response: Response;
    try {
      response = await fetch(proxyUrl(url, base), { headers: { Accept: "text/html" } });
    } catch (cause) {
      // До сервера не дошли: нет сети, режется прокси, оборвалось соединение.
      throw new TransportError(`${url} -> сеть недоступна`, undefined, cause);
    }
    if (!response.ok) {
      throw new TransportError(`${url} -> HTTP ${response.status}`, response.status);
    }
    return response.text();
  };
}
