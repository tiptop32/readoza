import type { ChannelMeta, Cursor, Post } from "../model.js";

/** Состояние фоновой докачки канала. */
export type ImportState = "none" | "partial" | "complete";

export interface Channel {
  /** `<source>:<username>`, например `telegram-public:sys_sa`. */
  id: string;
  source: string;
  /** Канонический username, полученный из data-post. */
  username: string;
  title: string;
  description?: string;
  avatar?: string;
  subscribers?: number;

  /** Границы канала, уточняются по мере докачки. */
  firstPostId?: number;
  lastPostId?: number;
  firstPostDate?: string;
  lastPostDate?: string;
  /** Точное число постов известно только после полной докачки. */
  postCount?: number;

  importState: ImportState;
  /** Где остановилась докачка. Позволяет продолжить после закрытия приложения. */
  importCursor?: Cursor;

  addedAt: string;
  lastOpenedAt?: string;
}

export interface StoredPost extends Post {
  /** Ссылка на канал. Отдельно от Post.channel, потому что ключ хранилища составной. */
  channelId: string;
  fetchedAt: string;
}

export interface Progress {
  channelId: string;
  /**
   * Где читатель остановился. Двигается в обе стороны: отлистал назад,
   * закрыл приложение — вернуться нужно туда, а не к самому дальнему посту.
   *
   * Хранится как message id, а не как порядковый номер: id переживает удаление.
   */
  lastReadId: number;
  /**
   * Самый дальний прочитанный пост. Только вперёд, поэтому перечитывание не
   * откатывает процент и счётчик. У записей, созданных до появления поля,
   * его нет — читать через readFrontier.
   */
  furthestReadId?: number;
  lastReadAt: string;
  startedAt: string;
}

/** Граница прочитанного с запасом на записи, сделанные до появления поля. */
export function readFrontier(progress: Progress): number {
  return Math.max(progress.furthestReadId ?? 0, progress.lastReadId);
}

export interface Bookmark {
  channelId: string;
  postId: number;
  note?: string;
  createdAt: string;
}

export interface PostQuery {
  /** Включительно. */
  fromId?: number;
  /** Включительно. */
  toId?: number;
  limit?: number;
  /** По умолчанию по возрастанию id, то есть в порядке чтения. */
  direction?: "forward" | "backward";
}

/**
 * Единый контракт хранилища. Реализация может быть любой: IndexedDB в браузере
 * и в webview мобильных и desktop-сборок, что-то другое позже.
 * Никакой код выше этого уровня не должен знать, что внизу IndexedDB.
 */
export interface Repo {
  putChannel(channel: Channel): Promise<void>;
  getChannel(id: string): Promise<Channel | undefined>;
  listChannels(): Promise<Channel[]>;
  removeChannel(id: string): Promise<void>;

  putPosts(channelId: string, posts: Post[], fetchedAt?: string): Promise<void>;
  getPosts(channelId: string, query?: PostQuery): Promise<StoredPost[]>;
  getPost(channelId: string, postId: number): Promise<StoredPost | undefined>;
  countPosts(channelId: string, upToId?: number): Promise<number>;

  getProgress(channelId: string): Promise<Progress | undefined>;
  setProgress(progress: Progress): Promise<void>;

  putBookmark(bookmark: Bookmark): Promise<void>;
  removeBookmark(channelId: string, postId: number): Promise<void>;
  listBookmarks(channelId?: string): Promise<Bookmark[]>;

  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting<T>(key: string, value: T): Promise<void>;

  close(): void;
}

/** Идентификатор канала в хранилище. */
export function channelId(source: string, username: string): string {
  return `${source}:${username}`;
}

/** Заготовка записи канала из метаданных источника. */
export function newChannel(source: string, meta: ChannelMeta, now = new Date()): Channel {
  const channel: Channel = {
    id: channelId(source, meta.username),
    source,
    username: meta.username,
    title: meta.title,
    importState: "none",
    addedAt: now.toISOString(),
  };
  if (meta.description) channel.description = meta.description;
  if (meta.avatar) channel.avatar = meta.avatar;
  if (meta.subscribers !== undefined) channel.subscribers = meta.subscribers;
  return channel;
}
