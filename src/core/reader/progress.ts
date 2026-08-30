import type { Channel, Progress } from "../storage/types.js";

/**
 * Прогресс чтения.
 *
 * Позиция это message id, а не порядковый номер. Id переживает удаление постов,
 * а порядковый номер сдвинулся бы у всего, что после удалённого.
 *
 * Процент считается по диапазону id и потому приблизителен: если канал сначала
 * постил редко, а потом часто, полоска пойдёт неравномерно. Поэтому основной
 * индикатор в интерфейсе это дата поста, а процент вторичен.
 * Точное «N из M» появляется только после полной докачки канала.
 */

export interface ProgressView {
  /** Позиция чтения. undefined, если канал ещё не открывали. */
  lastReadId?: number;
  /** 0..100, приблизительно, по диапазону id. */
  percent: number;
  /** Сколько постов прочитано из тех, что уже лежат локально. Честное число. */
  readCount: number;
  /** Всего постов. Известно только после полной докачки. */
  totalCount?: number;
  /** Дата поста, на котором остановились. Главный ориентир для человека. */
  atDate?: string;
  startedAt?: string;
  lastReadAt?: string;
}

/** Процент по диапазону id, с зажимом в 0..100. */
export function percentByIds(firstId: number, lastId: number, lastReadId: number): number {
  if (!Number.isFinite(firstId) || !Number.isFinite(lastId)) return 0;
  const span = lastId - firstId;
  if (span <= 0) return lastReadId >= lastId ? 100 : 0;
  const done = ((lastReadId - firstId) / span) * 100;
  return Math.min(100, Math.max(0, done));
}

export interface ProgressInput {
  channel: Channel;
  progress?: Progress;
  /** Число локально сохранённых постов с id <= lastReadId. */
  readCount?: number;
  /** Дата поста, на котором остановились. */
  atDate?: string;
}

export function describeProgress({
  channel,
  progress,
  readCount = 0,
  atDate,
}: ProgressInput): ProgressView {
  const view: ProgressView = { percent: 0, readCount };

  if (channel.importState === "complete" && channel.postCount !== undefined) {
    view.totalCount = channel.postCount;
  }
  if (!progress) return view;

  view.lastReadId = progress.lastReadId;
  view.startedAt = progress.startedAt;
  view.lastReadAt = progress.lastReadAt;
  if (atDate) view.atDate = atDate;

  if (channel.firstPostId !== undefined && channel.lastPostId !== undefined) {
    view.percent = percentByIds(channel.firstPostId, channel.lastPostId, progress.lastReadId);
  } else if (view.totalCount) {
    view.percent = Math.min(100, (readCount / view.totalCount) * 100);
  }
  return view;
}

/**
 * Двигает позицию только вперёд. Прокрутка назад для перечитывания не должна
 * откатывать прогресс: «прочитано до сюда» это граница, а не текущий взгляд.
 */
export function advanceRead(
  current: Progress | undefined,
  channelId: string,
  postId: number,
  now = new Date(),
): Progress {
  const at = now.toISOString();
  if (!current) {
    return { channelId, lastReadId: postId, lastReadAt: at, startedAt: at };
  }
  if (postId <= current.lastReadId) {
    return { ...current, lastReadAt: at };
  }
  return { ...current, lastReadId: postId, lastReadAt: at };
}

/** Явный перенос позиции, в том числе назад: «начать заново», переход по закладке. */
export function setReadPosition(
  current: Progress | undefined,
  channelId: string,
  postId: number,
  now = new Date(),
): Progress {
  const at = now.toISOString();
  return {
    channelId,
    lastReadId: postId,
    lastReadAt: at,
    startedAt: current?.startedAt ?? at,
  };
}
