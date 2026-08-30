import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { percentByIds } from "../core/reader/progress.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Repo } from "../core/storage/types.js";
import { formatMonth, formatPercent } from "./format.js";
import { PostView } from "./PostView.js";
import { useReader } from "./useReader.js";

/**
 * Полоса, по которой определяется «текущий» пост: тонкий горизонтальный слой на
 * трети высоты экрана. Отмечать прочитанным то, что просто попало во вьюпорт,
 * нельзя: у длинного поста видна только шапка, а короткие проскакивают пачками.
 */
const POSITION_BAND = "-33% 0px -66% 0px";
/** Позиция пишется не на каждый пиксель прокрутки. */
const SAVE_DEBOUNCE_MS = 600;

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

      {reader.error ? <p className="notice notice--error">{reader.error}</p> : null}

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
        {reader.loading ? "Loading…" : null}
        {reader.atEnd ? "You have reached the end of the channel." : null}
      </div>

      {channel.importState !== "complete" ? (
        <footer className="reader__footer">
          <button type="button" onClick={() => void reader.downloadAll()} disabled={reader.downloading}>
            {reader.downloading
              ? `Downloading… ${reader.downloaded} posts`
              : "Download whole channel for offline"}
          </button>
        </footer>
      ) : null}
    </div>
  );
}
