import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { percentByIds } from "../core/reader/progress.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Repo } from "../core/storage/types.js";
import { formatCount, formatMonth, formatPercent } from "./format.js";
import { PostView } from "./PostView.js";
import { useOnline } from "./useOnline.js";
import { useReader } from "./useReader.js";

/**
 * Полоса, по которой определяется «текущий» пост: тонкий горизонтальный слой на
 * трети высоты экрана. Отмечать прочитанным то, что просто попало во вьюпорт,
 * нельзя: у длинного поста видна только шапка, а короткие проскакивают пачками.
 */
const POSITION_BAND = "-33% 0px -66% 0px";
/** Позиция пишется не на каждый пиксель прокрутки. */
const SAVE_DEBOUNCE_MS = 600;
/** Замер на живом Telegram: одна страница ленты это около 20 постов. */
const POSTS_PER_REQUEST = 20;
/**
 * С какого размера канал считается большим. Порог по диапазону id, а не по числу
 * постов: точного числа постов Telegram не отдаёт, а полная докачка новостного
 * канала это тысячи запросов и почти гарантированная блокировка по IP.
 */
const HUGE_CHANNEL_SPAN = 20_000;

export function Reader({
  repo,
  source,
  channel,
  onExit,
}: {
  repo: Repo;
  source: Source;
  channel: Channel;
  onExit: () => void;
}): ReactElement {
  const reader = useReader(repo, source, channel);
  const online = useOnline();
  const [currentId, setCurrentId] = useState<number | undefined>(reader.anchorId);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);

  // Возврат к позиции чтения после первой загрузки окна.
  useEffect(() => {
    if (reader.loading || restoredRef.current) return;
    restoredRef.current = true;
    if (reader.anchorId === undefined) return;
    const target = document.getElementById(`post-${reader.anchorId}`);
    target?.scrollIntoView({ block: "start" });
    setCurrentId(reader.anchorId);
  }, [reader.loading, reader.anchorId]);

  // Определение текущего поста по полосе на трети экрана.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const raw = (entry.target as HTMLElement).dataset["postId"];
          if (raw) setCurrentId(Number.parseInt(raw, 10));
        }
      },
      { rootMargin: POSITION_BAND, threshold: 0 },
    );
    for (const node of list.querySelectorAll("[data-post-id]")) observer.observe(node);
    return () => observer.disconnect();
  }, [reader.posts]);

  // Сохранение позиции с задержкой.
  useEffect(() => {
    if (currentId === undefined) return;
    const timer = setTimeout(() => reader.markRead(currentId), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [currentId, reader.markRead]);

  // Подгрузка следующего окна, когда низ списка приблизился.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void reader.loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [reader.loadMore]);

  const percent =
    channel.firstPostId !== undefined && channel.lastPostId !== undefined && currentId !== undefined
      ? percentByIds(channel.firstPostId, channel.lastPostId, currentId)
      : 0;
  const currentDate = reader.posts.find((post) => post.id === currentId)?.date;

  // Оценка сверху: диапазон id больше числа постов ровно на удалённые.
  const estimatedPosts =
    channel.firstPostId !== undefined && channel.lastPostId !== undefined
      ? channel.lastPostId - channel.firstPostId
      : 0;
  const huge = estimatedPosts > HUGE_CHANNEL_SPAN;

  return (
    <div className="reader">
      <header className="reader__bar">
        <button type="button" className="reader__back" onClick={onExit} aria-label="Back">
          ‹
        </button>
        <div className="reader__title">
          <b>{channel.title}</b>
          <span>{formatMonth(currentDate ?? channel.firstPostDate)}</span>
        </div>
        <div className="reader__percent">{formatPercent(percent)}</div>
        <div className="reader__progress" style={{ width: `${percent}%` }} />
      </header>

      {online ? null : (
        <p className="notice notice--offline">
          You are offline. Everything already downloaded is still readable.
        </p>
      )}

      {reader.error ? (
        <p className="notice notice--error" title={reader.error}>
          Could not reach Telegram.{" "}
          <button type="button" className="notice__action" onClick={() => void reader.retry()}>
            Try again
          </button>
        </p>
      ) : null}

      <div className="reader__posts" ref={listRef}>
        {reader.posts.map((post) => (
          <PostView
            key={post.id}
            post={post}
            read={currentId !== undefined && post.id <= currentId}
          />
        ))}
      </div>

      <div ref={sentinelRef} className="reader__sentinel">
        {reader.atEnd
          ? "You have reached the end of the channel."
          : !online
            ? "More posts will load when you are back online."
            : reader.loading
              ? "Loading…"
              : null}
      </div>

      <footer className="reader__footer">
        <div className="reader__actions">
          {channel.importState === "complete" ? null : (
            <button
              type="button"
              onClick={() => void reader.downloadAll()}
              disabled={reader.downloading || !online}
            >
              {reader.downloading
                ? `Downloading… ${reader.downloaded} posts`
                : "Download whole channel for offline"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void reader.exportEpub()}
            disabled={reader.exporting}
          >
            {reader.exporting ? "Building the book…" : "Export as EPUB"}
          </button>
        </div>

        {huge && channel.importState !== "complete" ? (
          <p className="reader__warning">
            This channel is large. A full download is roughly{" "}
            {formatCount(Math.ceil(estimatedPosts / POSTS_PER_REQUEST))} requests to Telegram and
            can take a while.
          </p>
        ) : null}
        {channel.importState === "complete" ? null : (
          <p className="reader__warning">The book will contain only what is downloaded so far.</p>
        )}
      </footer>
    </div>
  );
}
