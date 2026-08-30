import type { Source } from "../source/types.js";
import { newChannel } from "../storage/types.js";
import type { Channel, Repo } from "../storage/types.js";
import { describeProgress, type ProgressView } from "./progress.js";

export type ReadozaErrorCode = "invalid-input" | "not-found" | "not-a-channel" | "empty-channel";

export class ReadozaError extends Error {
  constructor(
    readonly code: ReadozaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReadozaError";
  }
}

/**
 * Добавляет канал по пользовательскому вводу и готовит его к чтению с первого поста.
 *
 * Три запроса: карточка канала (около 11 KB), последняя страница ленты и первая.
 * Последняя нужна, чтобы сразу знать верхнюю границу id и показывать осмысленный
 * процент, не дожидаясь полной докачки.
 */
export async function addChannel(
  repo: Repo,
  source: Source,
  input: string,
  now = new Date(),
): Promise<Channel> {
  const username = source.match(input);
  if (!username) {
    throw new ReadozaError("invalid-input", `не похоже на ссылку на канал: ${input}`);
  }

  const meta = await source.fetchMeta(username);
  if (!meta) {
    throw new ReadozaError("not-found", `канал не найден: ${username}`);
  }

  // Последняя страница ленты. Заодно это единственная надёжная проверка,
  // что перед нами канал, а не группа: у группы ленты в t.me/s просто нет.
  // Проверять по слову «subscribers» нельзя, оно зависит от языка ответа.
  const latest = await source.fetchPage(username, { kind: "end" });
  if (latest.posts.length === 0) {
    throw new ReadozaError("not-a-channel", `у ${username} нет публичной ленты`);
  }

  // Канонический username берём из data-post: t.me/s/breakingmash отдаёт mash.
  const canonical = latest.channel || username;
  const first = await source.fetchPage(canonical, { kind: "start" });
  if (first.posts.length === 0) {
    throw new ReadozaError("empty-channel", `не удалось найти начало канала ${canonical}`);
  }

  const channel = newChannel(source.id, { ...meta, username: canonical }, now);
  const firstPost = first.posts[0];
  const lastPost = latest.posts.at(-1);
  if (firstPost) {
    channel.firstPostId = firstPost.id;
    if (firstPost.date) channel.firstPostDate = firstPost.date;
  }
  if (lastPost) {
    channel.lastPostId = lastPost.id;
    if (lastPost.date) channel.lastPostDate = lastPost.date;
  }
  if (first.next) {
    channel.importState = "partial";
    channel.importCursor = first.next;
  } else {
    // Канал целиком уместился в одну страницу.
    channel.importState = "complete";
  }

  await repo.putPosts(channel.id, first.posts, now.toISOString());
  if (channel.importState === "complete") {
    channel.postCount = await repo.countPosts(channel.id);
  }
  await repo.putChannel(channel);
  return channel;
}

/** Отметка об открытии канала: по ней сортируется экран «продолжить чтение». */
export async function touchChannel(repo: Repo, channelId: string, now = new Date()): Promise<void> {
  const channel = await repo.getChannel(channelId);
  if (!channel) return;
  await repo.putChannel({ ...channel, lastOpenedAt: now.toISOString() });
}

/** Собирает вид прогресса для экрана «продолжить чтение». */
export async function channelProgress(repo: Repo, channelId: string): Promise<ProgressView | null> {
  const channel = await repo.getChannel(channelId);
  if (!channel) return null;

  const progress = await repo.getProgress(channelId);
  if (!progress) return describeProgress({ channel });

  const [readCount, post] = await Promise.all([
    repo.countPosts(channelId, progress.lastReadId),
    repo.getPost(channelId, progress.lastReadId),
  ]);
  const input = { channel, progress, readCount, ...(post?.date ? { atDate: post.date } : {}) };
  return describeProgress(input);
}
