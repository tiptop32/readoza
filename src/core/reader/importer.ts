import type { Cursor, Page } from "../model.js";
import type { Source } from "../source/types.js";
import type { Channel, Repo } from "../storage/types.js";
import { type RetryOptions, withRetry } from "./retry.js";

/**
 * Фоновая докачка канала.
 *
 * Замеры на живом Telegram: примерно 20 постов и 1.2–2.4 s на запрос. Канал на
 * 1800 постов это около 95 запросов, две-три минуты с паузами. Дешёвого способа
 * забрать «только id и даты» нет, Telegram всё равно отдаёт полный HTML, поэтому
 * выбор бинарный: качаем всё или ничего.
 *
 * Докачка возобновляемая: курсор пишется в запись канала после каждой страницы,
 * поэтому закрытие приложения не теряет прогресс.
 */

export interface ImportProgress {
  channelId: string;
  /** Сколько страниц забрано за этот запуск. */
  pages: number;
  /** Сколько постов сохранено за этот запуск. */
  posts: number;
  /** Максимальный id, дошедший до хранилища. */
  lastId?: number;
  /** Канал докачан до конца. */
  done: boolean;
  /** Остановлено извне: докачку можно продолжить позже с того же курсора. */
  aborted: boolean;
}

export interface ImportOptions {
  /** Пауза между запросами. Бережём и Telegram, и себя от блокировки. */
  delayMs?: number;
  /** Предохранитель от бесконечной ленты. 500 страниц это около 10 000 постов. */
  maxPages?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
  /** Инъекция для тестов, чтобы не ждать настоящие паузы. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_DELAY_MS = 1000;
const DEFAULT_MAX_PAGES = 500;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function sameCursor(a: Cursor, b: Cursor): boolean {
  if (a.kind !== b.kind) return false;
  return "id" in a && "id" in b ? a.id === b.id : true;
}

/** Обновляет известные границы канала по только что полученной странице. */
function widenBounds(channel: Channel, page: Page): Channel {
  const first = page.posts[0];
  const last = page.posts.at(-1);
  if (!first || !last) return channel;

  const next = { ...channel };
  if (next.firstPostId === undefined || first.id < next.firstPostId) {
    next.firstPostId = first.id;
    if (first.date) next.firstPostDate = first.date;
  }
  if (next.lastPostId === undefined || last.id > next.lastPostId) {
    next.lastPostId = last.id;
    if (last.date) next.lastPostDate = last.date;
  }
  return next;
}

export interface ImportStep {
  /** Сколько постов пришло на этой странице. */
  posts: number;
  lastId?: number;
  /** Канал дочитан до конца. */
  done: boolean;
}

/**
 * Одна страница докачки: элементарный шаг, из которого собраны и фоновый обход,
 * и подгрузка по мере чтения, когда читалка упирается в край локального кэша.
 * Курсор сохраняется здесь же, поэтому шаг безопасно прервать в любой момент.
 */
export async function importNextPage(
  repo: Repo,
  source: Source,
  channelId: string,
  retry: RetryOptions = {},
): Promise<ImportStep> {
  const stored = await repo.getChannel(channelId);
  if (!stored) throw new Error(`канал не найден в хранилище: ${channelId}`);
  if (stored.importState === "complete") {
    const step: ImportStep = { posts: 0, done: true };
    if (stored.lastPostId !== undefined) step.lastId = stored.lastPostId;
    return step;
  }

  const cursor: Cursor = stored.importCursor ?? { kind: "start" };
  // Один 429 или моргнувшая сеть не должны ронять докачку, которая идёт минуты.
  const page = await withRetry(() => source.fetchPage(stored.username, cursor), retry);

  let channel = stored;
  if (page.posts.length > 0) {
    await repo.putPosts(channelId, page.posts);
    channel = widenBounds(channel, page);
  }

  // Конец канала: Telegram не отдал курсор вперёд.
  // Тот же курсор второй раз означает, что лента не двигается, и это тоже конец.
  const done = !page.next || sameCursor(page.next, cursor);
  if (done) {
    const { importCursor: _drop, ...rest } = channel;
    channel = { ...rest, importState: "complete", postCount: await repo.countPosts(channelId) };
  } else {
    channel = { ...channel, importState: "partial", importCursor: page.next };
  }
  await repo.putChannel(channel);

  const step: ImportStep = { posts: page.posts.length, done };
  const lastId = page.posts.at(-1)?.id;
  if (lastId !== undefined) step.lastId = lastId;
  return step;
}

/**
 * Докачивает канал от сохранённого курсора до конца.
 * Возвращает итог запуска; при `aborted` вызов можно просто повторить позже.
 */
export async function importChannel(
  repo: Repo,
  source: Source,
  channelId: string,
  options: ImportOptions = {},
): Promise<ImportProgress> {
  const {
    delayMs = DEFAULT_DELAY_MS,
    maxPages = DEFAULT_MAX_PAGES,
    signal,
    onProgress,
    sleep = defaultSleep,
  } = options;

  const stored = await repo.getChannel(channelId);
  if (!stored) throw new Error(`канал не найден в хранилище: ${channelId}`);

  const result: ImportProgress = { channelId, pages: 0, posts: 0, done: false, aborted: false };
  if (stored.importState === "complete") {
    result.done = true;
    if (stored.lastPostId !== undefined) result.lastId = stored.lastPostId;
    onProgress?.(result);
    return result;
  }

  while (result.pages < maxPages) {
    if (signal?.aborted) {
      result.aborted = true;
      break;
    }

    const step = await importNextPage(repo, source, channelId, { ...(signal ? { signal } : {}), sleep });
    result.pages += 1;
    result.posts += step.posts;
    if (step.lastId !== undefined) result.lastId = step.lastId;

    if (step.done) {
      result.done = true;
      break;
    }

    onProgress?.({ ...result });
    await sleep(delayMs);
  }

  onProgress?.({ ...result });
  return result;
}
