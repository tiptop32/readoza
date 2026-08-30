import type { ReactElement } from "react";
import type { ProgressView } from "../core/reader/progress.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Repo } from "../core/storage/types.js";
import { formatCount, formatLastRead, formatMonth, formatPercent, formatSpan } from "./format.js";
import { useChannelActions } from "./useChannelActions.js";

/** Замер на живом Telegram: одна страница ленты это около 20 постов. */
const POSTS_PER_REQUEST = 20;
/**
 * С какого размера канал считается большим. Порог по диапазону id, а не по числу
 * постов: точного числа постов Telegram не отдаёт, а полная докачка новостного
 * канала это тысячи запросов и почти гарантированная блокировка по IP.
 */
const HUGE_CHANNEL_SPAN = 20_000;

export function ChannelEntry({
  repo,
  source,
  channel,
  view,
  online,
  onOpen,
  onRemove,
  onChanged,
}: {
  repo: Repo;
  source: Source;
  channel: Channel;
  view: ProgressView | undefined;
  online: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onChanged: () => void;
}): ReactElement {
  const actions = useChannelActions(repo, source, channel, onChanged);
  const percent = view?.percent ?? 0;
  const started = view?.lastReadId !== undefined;
  const complete = channel.importState === "complete";

  const estimatedPosts =
    channel.firstPostId !== undefined && channel.lastPostId !== undefined
      ? channel.lastPostId - channel.firstPostId
      : 0;
  const huge = !complete && estimatedPosts > HUGE_CHANNEL_SPAN;

  return (
    <li className="entry">
      <div className="entry__row">
        <button type="button" className="entry__main" onClick={onOpen}>
          {channel.avatar ? <img className="entry__avatar" src={channel.avatar} alt="" /> : null}
          <span className="entry__body">
            <b className="entry__title">{channel.title}</b>
            <span className="entry__bar">
              <span className="entry__bar-fill" style={{ width: `${percent}%` }} />
            </span>
            <span className="entry__meta">
              {/* Пока прогресс не прочитан из хранилища, «not started» было бы
                  враньём: канал может быть начат. Показываем то, что точно знаем. */}
              {view === undefined
                ? formatSpan(channel.firstPostDate, channel.lastPostDate)
                : started
                  ? `${formatPercent(percent)} · ${formatMonth(view.atDate)} · ${formatCount(view.readCount)} posts read`
                  : `not started · ${formatMonth(channel.firstPostDate)}`}
              {view?.totalCount ? ` of ${formatCount(view.totalCount)}` : ""}
            </span>
            {view?.lastReadAt ? (
              <span className="entry__meta entry__meta--dim">
                last read {formatLastRead(view.lastReadAt)}
              </span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          className="entry__remove"
          onClick={onRemove}
          aria-label={`Remove ${channel.title}`}
        >
          ×
        </button>
      </div>

      <div className="entry__actions">
        {complete ? null : (
          <button
            type="button"
            onClick={() => void actions.downloadAll()}
            disabled={actions.downloading || !online}
          >
            {actions.downloading
              ? `Downloading… ${formatCount(actions.downloaded)} posts`
              : "Download for offline"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void actions.exportEpub()}
          disabled={actions.exporting}
        >
          {actions.stage === "downloading"
            ? `Downloading the channel… ${formatCount(actions.downloaded)} posts`
            : actions.stage === "building"
              ? "Building the book…"
              : complete && actions.storedCount !== undefined
                ? `Export ${formatCount(actions.storedCount)} posts as EPUB`
                : "Export whole channel as EPUB"}
        </button>
      </div>

      {huge ? (
        <p className="entry__warning">
          Large channel: a full download is roughly{" "}
          {formatCount(Math.ceil(estimatedPosts / POSTS_PER_REQUEST))} requests to Telegram.
        </p>
      ) : null}
      {complete ? null : (
        <p className="entry__warning">
          {actions.storedCount === undefined
            ? "Exporting downloads the rest of the channel first."
            : `${formatCount(actions.storedCount)} posts downloaded so far. Exporting fetches the rest of the channel before building the book.`}
        </p>
      )}
      {/* Докачка может закончиться не только успехом, и молчать об этом нельзя:
          снаружи неполный канал выглядит точно так же, как полный. */}
      {actions.lastRun && !actions.lastRun.done ? (
        <p className="entry__warning">
          {actions.lastRun.stalled
            ? `Telegram stopped returning older posts after ${formatCount(actions.lastRun.posts)} of them. The channel is not fully downloaded; try again later.`
            : `Download paused after ${formatCount(actions.lastRun.posts)} posts. Press again to continue where it stopped.`}
        </p>
      ) : null}

      {actions.exported ? (
        <p className="entry__warning">
          Saved {formatCount(actions.exported.posts)} posts in{" "}
          {formatCount(actions.exported.chapters)} chapters.
        </p>
      ) : null}
      {actions.error ? <p className="notice notice--error">{actions.error}</p> : null}
    </li>
  );
}
