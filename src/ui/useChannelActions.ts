import { useCallback, useEffect, useState } from "react";
import { buildEpub } from "../core/export/epub.js";
import { importChannel, type ImportProgress } from "../core/reader/importer.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Repo } from "../core/storage/types.js";
import { saveFile } from "./download.js";
import { sanitizePostHtml } from "./sanitize.js";

/**
 * Действия над каналом целиком: полная докачка и выгрузка книги.
 *
 * Живут отдельно от читалки, потому что относятся к каналу, а не к текущему
 * чтению: их место на карточке канала в списке, откуда их можно запустить,
 * не открывая сам канал.
 */
export interface ChannelActions {
  downloadAll: () => Promise<void>;
  downloading: boolean;
  /** Сколько постов забрано за текущую докачку. */
  downloaded: number;
  exportEpub: () => Promise<void>;
  exporting: boolean;
  /** Чем занят экспорт прямо сейчас: докачкой канала или сборкой файла. */
  stage?: "downloading" | "building";
  /**
   * Сколько постов канала лежит локально. Ровно столько попадёт в книгу, и
   * это единственное число, по которому видно, что канал докачан не весь.
   */
  storedCount?: number;
  /** Итог последней выгрузки, чтобы не гадать, что оказалось в файле. */
  exported?: { posts: number; chapters: number };
  /** Чем закончилась последняя докачка: докачал, упёрся, оборвался. */
  lastRun?: ImportProgress;
  error?: string;
}

export function useChannelActions(
  repo: Repo,
  source: Source,
  channel: Channel,
  onChanged?: () => void,
): ChannelActions {
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [stage, setStage] = useState<"downloading" | "building" | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [storedCount, setStoredCount] = useState<number | undefined>();
  const [exported, setExported] = useState<{ posts: number; chapters: number } | undefined>();
  const [lastRun, setLastRun] = useState<ImportProgress | undefined>();

  /*
   * Обрыв докачки при размонтировании убран намеренно. Он ставился против гонки
   * с удалением канала, но открытие канала для чтения тоже размонтирует список,
   * и докачка обрывалась молча посреди работы. От воскрешения удалённого канала
   * защищает проверка в самом импортёре, а не здесь.
   */

  // Пересчитывается после докачки: запись канала меняется, эффект повторяется.
  useEffect(() => {
    let cancelled = false;
    void repo.countPosts(channel.id).then((count) => {
      if (!cancelled) setStoredCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, [repo, channel.id, channel.importState, channel.postCount]);

  const downloadAll = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setError(undefined);
    setLastRun(undefined);
    try {
      const run = await importChannel(repo, source, channel.id, {
        onProgress: (progress) => setDownloaded(progress.posts),
      });
      setLastRun(run);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDownloading(false);
    }
  }, [downloading, repo, source, channel.id, onChanged]);

  /**
   * Книга по всему каналу.
   *
   * Экспорт сначала дотягивает канал до конца и только потом собирает файл:
   * книга «по каналу» и книга «по тому, что успело прочитаться» — разные вещи,
   * и вторая никому не нужна. Если Telegram оборвал ленту раньше конца, файл
   * всё равно отдаётся, но с честным сообщением о том, что он неполон.
   */
  const exportEpub = useCallback(async () => {
    if (exporting || downloading) return;
    setExporting(true);
    setError(undefined);
    setExported(undefined);
    setLastRun(undefined);
    try {
      const current = await repo.getChannel(channel.id);
      if (current && current.importState !== "complete") {
        setStage("downloading");
        const run = await importChannel(repo, source, channel.id, {
          onProgress: (progress) => setDownloaded(progress.posts),
        });
        setLastRun(run);
        onChanged?.();
      }

      setStage("building");
      const target = (await repo.getChannel(channel.id)) ?? channel;
      const posts = await repo.getPosts(channel.id);
      const book = buildEpub(target, posts, sanitizePostHtml);
      saveFile(book.bytes, book.filename, "application/epub+zip");
      setExported({ posts: book.posts, chapters: book.chapters });
      setStoredCount(posts.length);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStage(undefined);
      setExporting(false);
    }
  }, [exporting, downloading, repo, source, channel, onChanged]);

  const actions: ChannelActions = {
    downloadAll,
    downloading,
    downloaded,
    exportEpub,
    exporting,
  };
  if (error) actions.error = error;
  if (storedCount !== undefined) actions.storedCount = storedCount;
  if (exported) actions.exported = exported;
  if (lastRun) actions.lastRun = lastRun;
  if (stage) actions.stage = stage;
  return actions;
}
