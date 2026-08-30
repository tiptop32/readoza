import { isRetryable } from "../source/errors.js";

/**
 * Повтор с нарастающей паузой.
 *
 * Telegram не обещает нам ничего: ни лимитов, ни стабильности. Один 429 или
 * оборванное соединение не должны ронять докачку канала, которая идёт минуты
 * и уже накопила прогресс. Повторяем только то, что имеет смысл повторять.
 */

export interface RetryOptions {
  /** Всего попыток, включая первую. */
  attempts?: number;
  /** Пауза перед первым повтором; дальше удваивается. */
  baseDelayMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 1000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = DEFAULT_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    signal,
    sleep = defaultSleep,
    onRetry,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts;
      // Остановка снаружи важнее повторов: пользователь ушёл со страницы.
      if (isLast || signal?.aborted || !isRetryable(error)) throw error;

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      onRetry?.(attempt, delayMs, error);
      await sleep(delayMs);
    }
  }
  throw lastError;
}
