import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { percentByIds } from "../core/reader/progress.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Repo } from "../core/storage/types.js";
import { formatMonth, formatPercent } from "./format.js";
import { Lightbox } from "./Lightbox.js";
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
  const [lightbox, setLightbox] = useState<{ postId: number; index: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const [restored, setRestored] = useState(false);
  /** Высота документа до вставки постов сверху, чтобы вернуть прокрутку на место. */
  const heightBeforePrepend = useRef<number | null>(null);

  // Возврат к позиции чтения после первой загрузки окна.
  useEffect(() => {
    if (reader.loading || restoredRef.current) return;
    restoredRef.current = true;
    setRestored(true);
    if (reader.anchorId === undefined) return;
    const target = document.getElementById(`post-${reader.anchorId}`);
    target?.scrollIntoView({ block: "start" });
    setCurrentId(reader.anchorId);
  }, [reader.loading, reader.anchorId]);

  /**
   * Подгрузка вверх сдвигает всё содержимое вниз ровно на высоту добавленного.
   * Без компенсации читатель, доскроллив до верха, каждый раз улетал бы вперёд.
   */
  const loadEarlier = useCallback(async () => {
    if (reader.atStart) return;
    heightBeforePrepend.current = document.documentElement.scrollHeight;
    await reader.loadEarlier();
  }, [reader]);

  useLayoutEffect(() => {
    const before = heightBeforePrepend.current;
    if (before === null) return;
    heightBeforePrepend.current = null;
    const delta = document.documentElement.scrollHeight - before;
    if (delta > 0) window.scrollBy(0, delta);
  }, [reader.posts]);

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

  /*
   * Сохранение позиции с задержкой, и только после восстановления: позиция
   * ходит в обе стороны, а до восстановления страница стоит на нуле, где в
   * полосу попадают посты выше сохранённого места. Без этой проверки открытие
   * канала само откатывало бы позицию к началу загруженного окна.
   */
  useEffect(() => {
    if (!restored || currentId === undefined) return;
    const timer = setTimeout(() => reader.markRead(currentId), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [restored, currentId, reader.markRead]);

  // Подгрузка предыдущего окна при движении вверх. Включается только после
  // восстановления позиции: иначе сработала бы на нулевой прокрутке при открытии.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel || !restored || reader.atStart) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadEarlier();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [restored, reader.atStart, loadEarlier]);

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
  const readMark = Math.max(currentId ?? 0, reader.furthestReadId ?? 0);

  const lightboxPhotos = lightbox
    ? (reader.posts
        .find((post) => post.id === lightbox.postId)
        ?.media.filter((media) => media.kind === "photo") ?? [])
    : [];

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

      <div ref={topSentinelRef} className="reader__sentinel reader__sentinel--top">
        {reader.atStart ? "This is the first post of the channel." : "Loading earlier posts…"}
      </div>

      <div className="reader__posts" ref={listRef}>
        {reader.posts.map((post) => (
          <PostView
            key={post.id}
            post={post}
            // Прочитанным помечает граница, а не текущий взгляд: отлистав назад,
            // читатель не должен видеть уже пройденное как непрочитанное.
            read={post.id <= readMark}
            onOpenImage={(index) => setLightbox({ postId: post.id, index })}
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

      {lightbox && lightboxPhotos.length > 0 ? (
        <Lightbox
          photos={lightboxPhotos}
          index={lightbox.index}
          onIndex={(index) => setLightbox({ postId: lightbox.postId, index })}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}
