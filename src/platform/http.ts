import { TransportError } from "../core/source/errors.js";

/**
 * Общая часть всех транспортов: запрос HTML и превращение сбоя в TransportError,
 * по которому слой повторов решает, есть ли смысл пробовать ещё раз.
 *
 * Различаются транспорты ровно двумя вещами: куда идёт запрос (напрямую или через
 * прокси) и какими заголовками. Всё остальное здесь.
 */

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<HttpResponse>;

/**
 * Telegram отдаёт публичное превью и вовсе без User-Agent (проверено), но с
 * обычным браузерным заголовком поведение предсказуемее. В браузере он
 * запрещён и молча игнорируется, поэтому ставится только там, где работает.
 */
export const READER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export async function readHtml(
  fetchImpl: FetchLike,
  url: string,
  options: { requestUrl?: string; headers?: Record<string, string> } = {},
): Promise<string> {
  const headers = { Accept: "text/html", ...options.headers };
  let response: HttpResponse;
  try {
    response = await fetchImpl(options.requestUrl ?? url, { headers });
  } catch (cause) {
    // До сервера не дошли: нет сети, режется прокси, оборвалось соединение.
    throw new TransportError(`${url} -> сеть недоступна`, undefined, cause);
  }
  if (!response.ok) {
    throw new TransportError(`${url} -> HTTP ${response.status}`, response.status);
  }
  return response.text();
}
