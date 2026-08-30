import { useCallback, useEffect, useRef, useState } from "react";
import { importNextPage } from "../core/reader/importer.js";
import { updateRead } from "../core/reader/progress.js";
import { readFrontier } from "../core/storage/types.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Progress, Repo, StoredPost } from "../core/storage/types.js";

/** Сколько постов держим в окне подгрузки. */
const WINDOW = 20;
/** Немного контекста выше позиции чтения, чтобы было видно, где остановился. */
const LOOKBACK = 5;
/** Предохранитель: сколько страниц готовы дотянуть из сети за одну подгрузку. */
const MAX_FETCH_ROUNDS = 6;

export interface ReaderApi {
  posts: StoredPost[];
  loading: boolean;
  atEnd: boolean;
  error?: string;
  /** Позиция, на которую нужно проскроллить после первой загрузки. */
  anchorId?: number;
  /** Граница прочитанного: до сюда посты помечаются прочитанными. */
  furthestReadId?: number;
  loadMore: () => Promise<void>;
  /** Подгрузить посты выше текущего окна: возврат к уже прочитанному. */
  loadEarlier: () => Promise<void>;
  /** Выше ничего нет: это первый пост канала. */
  atStart: boolean;
  /** Повторить последнюю неудавшуюся подгрузку после сбоя сети. */
  retry: () => Promise<void>;
  markRead: (postId: number) => void;
}

function merge(a: StoredPost[], b: StoredPost[]): StoredPost[] {
  const byId = new Map<number, StoredPost>();
  for (const post of a) byId.set(post.id, post);
  for (const post of b) byId.set(post.id, post);
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

/**
 * Чтение канала по порядку.
 *
 * Ленивая модель: сначала показываем то, что уже лежит локально, и дотягиваем
 * страницы из сети только когда читатель подошёл к краю кэша. Полная докачка
 * канала запускается отдельно и явно, чтобы не долбить Telegram на каждом открытии.
 */
export function useReader(repo: Repo, source: Source, channel: Channel): ReaderApi {
  const [posts, setPosts] = useState<StoredPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [atStart, setAtStart] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [anchorId, setAnchorId] = useState<number | undefined>();
  const [furthestReadId, setFurthestReadId] = useState<number | undefined>();

  const progressRef = useRef<Progress | undefined>(undefined);
  const busyRef = useRef(false);
  const earlierRef = useRef(false);

  /** Канал докачан до конца, дальше постов не появится. */
  const checkEnd = useCallback(async (): Promise<void> => {
    const fresh = await repo.getChannel(channel.id);
    if (fresh?.importState === "complete") setAtEnd(true);
  }, [repo, channel.id]);

  /** Отдаёт окно постов от fromId, дотягивая страницы из сети, если локально пусто. */
  const fillForward = useCallback(
    async (fromId: number, limit: number): Promise<StoredPost[]> => {
      let batch = await repo.getPosts(channel.id, { fromId, limit });
      let rounds = 0;
      while (batch.length < limit && rounds < MAX_FETCH_ROUNDS) {
        const step = await importNextPage(repo, source, channel.id);
        rounds += 1;
        batch = await repo.getPosts(channel.id, { fromId, limit });
        if (step.done) break;
      }
      return batch;
    },
    [repo, source, channel.id],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAtEnd(false);
    setAtStart(false);
    setError(undefined);
    setPosts([]);

    void (async () => {
      try {
        const progress = await repo.getProgress(channel.id);
        progressRef.current = progress;
        const anchor = progress?.lastReadId ?? channel.firstPostId ?? 0;

        const [before, after] = await Promise.all([
          repo.getPosts(channel.id, { toId: anchor, limit: LOOKBACK, direction: "backward" }),
          fillForward(anchor, WINDOW),
        ]);
        if (cancelled) return;

        setPosts(merge([...before].reverse(), after));
        setAnchorId(progress?.lastReadId);
        setFurthestReadId(progress ? readFrontier(progress) : undefined);
        // Окно назад неполное — значит выше уже ничего нет.
        if (before.length < LOOKBACK) setAtStart(true);
        if (after.length < WINDOW) await checkEnd();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repo, channel.id, channel.firstPostId, fillForward, checkEnd]);

  const loadMore = useCallback(async () => {
    if (busyRef.current || atEnd || loading) return;
    busyRef.current = true;
    try {
      const lastId = posts.at(-1)?.id;
      const fromId = lastId === undefined ? (channel.firstPostId ?? 0) : lastId + 1;
      const batch = await fillForward(fromId, WINDOW);
      if (batch.length > 0) setPosts((prev) => merge(prev, batch));
      // Неполное окно на докачанном канале означает конец. Проверять это надо
      // сразу: иначе признак конца появится только после лишней прокрутки,
      // которую читателю пришлось бы сделать вслепую.
      if (batch.length < WINDOW) await checkEnd();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
    }
  }, [atEnd, loading, posts, channel.firstPostId, fillForward, checkEnd]);

  /**
   * Подгрузка вверх. В сеть не ходит и не должна: читаем канал только вперёд
   * от первого поста, поэтому всё, что выше текущей позиции, уже лежит локально.
   */
  const loadEarlier = useCallback(async () => {
    if (earlierRef.current || atStart || loading) return;
    const firstId = posts[0]?.id;
    if (firstId === undefined) return;

    earlierRef.current = true;
    try {
      const batch = await repo.getPosts(channel.id, {
        toId: firstId - 1,
        limit: WINDOW,
        direction: "backward",
      });
      if (batch.length > 0) setPosts((prev) => merge([...batch].reverse(), prev));
      if (batch.length < WINDOW) setAtStart(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      earlierRef.current = false;
    }
  }, [atStart, loading, posts, repo, channel.id]);

  const retry = useCallback(async () => {
    setError(undefined);
    await loadMore();
  }, [loadMore]);

  const markRead = useCallback(
    (postId: number) => {
      const next = updateRead(progressRef.current, channel.id, postId);
      progressRef.current = next;
      setFurthestReadId(readFrontier(next));
      void repo.setProgress(next);
    },
    [repo, channel.id],
  );

  const api: ReaderApi = {
    posts,
    loading,
    atEnd,
    atStart,
    loadMore,
    loadEarlier,
    retry,
    markRead,
  };
  if (error) api.error = error;
  if (anchorId !== undefined) api.anchorId = anchorId;
  if (furthestReadId !== undefined) api.furthestReadId = furthestReadId;
  return api;
}
