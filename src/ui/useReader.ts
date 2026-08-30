import { useCallback, useEffect, useRef, useState } from "react";
import { buildEpub } from "../core/export/epub.js";
import { importChannel, importNextPage } from "../core/reader/importer.js";
import { advanceRead } from "../core/reader/progress.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Progress, Repo, StoredPost } from "../core/storage/types.js";
import { saveFile } from "./download.js";
import { sanitizePostHtml } from "./sanitize.js";

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
  loadMore: () => Promise<void>;
  /** Повторить последнюю неудавшуюся подгрузку после сбоя сети. */
  retry: () => Promise<void>;
  markRead: (postId: number) => void;
  downloadAll: () => Promise<void>;
  downloading: boolean;
  downloaded: number;
  /** Собрать книгу из того, что уже скачано, и отдать файл пользователю. */
  exportEpub: () => Promise<void>;
  exporting: boolean;
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
  const [error, setError] = useState<string | undefined>();
  const [anchorId, setAnchorId] = useState<number | undefined>();
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [exporting, setExporting] = useState(false);

  const progressRef = useRef<Progress | undefined>(undefined);
  const busyRef = useRef(false);

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

  const retry = useCallback(async () => {
    setError(undefined);
    await loadMore();
  }, [loadMore]);

  const markRead = useCallback(
    (postId: number) => {
      const next = advanceRead(progressRef.current, channel.id, postId);
      progressRef.current = next;
      void repo.setProgress(next);
    },
    [repo, channel.id],
  );

  const downloadAll = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await importChannel(repo, source, channel.id, {
        onProgress: (p) => setDownloaded(p.posts),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDownloading(false);
    }
  }, [downloading, repo, source, channel.id]);

  const exportEpub = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const all = await repo.getPosts(channel.id);
      const book = buildEpub(channel, all, sanitizePostHtml);
      saveFile(book.bytes, book.filename, "application/epub+zip");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  }, [exporting, repo, channel]);

  const api: ReaderApi = {
    posts,
    loading,
    atEnd,
    loadMore,
    retry,
    markRead,
    downloadAll,
    downloading,
    downloaded,
    exportEpub,
    exporting,
  };
  if (error) api.error = error;
  if (anchorId !== undefined) api.anchorId = anchorId;
  return api;
}
