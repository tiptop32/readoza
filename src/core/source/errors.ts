/**
 * Ошибка транспорта.
 *
 * Существует ради одного решения: повторять запрос или нет. t.me не документирован,
 * его лимиты неизвестны, поэтому отличать «сеть моргнула, попробуй ещё» от
 * «канала нет, повторять бессмысленно» приходится по коду ответа.
 */
export class TransportError extends Error {
  constructor(
    message: string,
    /** HTTP-код. Отсутствует, если до сервера вообще не дошли. */
    readonly status?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TransportError";
  }

  /** Есть ли смысл повторять запрос. */
  get retryable(): boolean {
    if (this.status === undefined) return true; // сеть недоступна
    if (this.status === 429) return true; // упёрлись в лимит
    return this.status >= 500; // на стороне Telegram
  }
}

/** Стоит ли повторять этот сбой. Ошибка самого fetch приходит как TypeError. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TransportError) return error.retryable;
  return error instanceof TypeError;
}
