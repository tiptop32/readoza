import { useCallback, useEffect, useRef, useState } from "react";
import { buildEpub } from "../core/export/epub.js";
import { importChannel } from "../core/reader/importer.js";
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
  const [error, setError] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  // Карточка исчезает вместе с удалённым каналом, и докачку надо оборвать:
  // иначе она допишет посты каналу, которого больше нет.
  useEffect(() => () => abortRef.current?.abort(), []);

  const downloadAll = useCallback(async () => {
    if (downloading) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setDownloading(true);
    setError(undefined);
    try {
      await importChannel(repo, source, channel.id, {
        signal: controller.signal,
        onProgress: (progress) => setDownloaded(progress.posts),
      });
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDownloading(false);
    }
  }, [downloading, repo, source, channel.id, onChanged]);

  const exportEpub = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setError(undefined);
    try {
      const posts = await repo.getPosts(channel.id);
      const book = buildEpub(channel, posts, sanitizePostHtml);
      saveFile(book.bytes, book.filename, "application/epub+zip");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  }, [exporting, repo, channel]);

  const actions: ChannelActions = {
    downloadAll,
    downloading,
    downloaded,
    exportEpub,
    exporting,
  };
  if (error) actions.error = error;
  return actions;
}
