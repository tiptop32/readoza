import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { channelProgress } from "../core/reader/library.js";
import type { ProgressView } from "../core/reader/progress.js";
import type { Channel, Repo } from "../core/storage/types.js";
import { formatCount, formatLastRead, formatMonth, formatPercent } from "./format.js";

export function ChannelList({
  repo,
  channels,
  onOpen,
  onRemove,
}: {
  repo: Repo;
  channels: Channel[];
  onOpen: (channel: Channel) => void;
  onRemove: (channel: Channel) => void;
}): ReactElement | null {
  const [views, setViews] = useState<Record<string, ProgressView>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        channels.map(async (channel) => [channel.id, await channelProgress(repo, channel.id)] as const),
      );
      if (cancelled) return;
      const next: Record<string, ProgressView> = {};
      for (const [id, view] of entries) if (view) next[id] = view;
      setViews(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, channels]);

  if (channels.length === 0) return null;

  return (
    <section className="library">
      <h2 className="library__heading">Continue reading</h2>
      <ul className="library__list">
        {channels.map((channel) => {
          const view = views[channel.id];
          const percent = view?.percent ?? 0;
          const started = view?.lastReadId !== undefined;
          return (
            <li key={channel.id} className="entry">
              <button type="button" className="entry__main" onClick={() => onOpen(channel)}>
                {channel.avatar ? <img className="entry__avatar" src={channel.avatar} alt="" /> : null}
                <span className="entry__body">
                  <b className="entry__title">{channel.title}</b>
                  <span className="entry__bar">
                    <span className="entry__bar-fill" style={{ width: `${percent}%` }} />
                  </span>
                  <span className="entry__meta">
                    {started
                      ? `${formatPercent(percent)} · ${formatMonth(view?.atDate)} · ${formatCount(view?.readCount ?? 0)} posts read`
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
                onClick={() => onRemove(channel)}
                aria-label={`Remove ${channel.title}`}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
