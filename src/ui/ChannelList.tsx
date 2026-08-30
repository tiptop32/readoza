import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { channelProgress } from "../core/reader/library.js";
import type { ProgressView } from "../core/reader/progress.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Repo } from "../core/storage/types.js";
import { ChannelEntry } from "./ChannelEntry.js";
import { useOnline } from "./useOnline.js";

export function ChannelList({
  repo,
  source,
  channels,
  onOpen,
  onRemove,
  onChanged,
}: {
  repo: Repo;
  source: Source;
  channels: Channel[];
  onOpen: (channel: Channel) => void;
  onRemove: (channel: Channel) => void;
  onChanged: () => void;
}): ReactElement | null {
  const [views, setViews] = useState<Record<string, ProgressView>>({});
  const online = useOnline();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        channels.map(
          async (channel) => [channel.id, await channelProgress(repo, channel.id)] as const,
        ),
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
        {channels.map((channel) => (
          <ChannelEntry
            key={channel.id}
            repo={repo}
            source={source}
            channel={channel}
            view={views[channel.id]}
            online={online}
            onOpen={() => onOpen(channel)}
            onRemove={() => onRemove(channel)}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  );
}
