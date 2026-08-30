import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { touchChannel } from "../core/reader/library.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Repo } from "../core/storage/types.js";
import { AddChannel } from "./AddChannel.js";
import { ChannelList } from "./ChannelList.js";
import { Reader } from "./Reader.js";

export function App({ repo, source }: { repo: Repo; source: Source }): ReactElement {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    setChannels(await repo.listChannels());
  }, [repo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (channel: Channel) => {
      await touchChannel(repo, channel.id);
      setActiveId(channel.id);
    },
    [repo],
  );

  const active = channels.find((channel) => channel.id === activeId);
  if (active) {
    return (
      <Reader
        repo={repo}
        source={source}
        channel={active}
        onExit={() => {
          setActiveId(undefined);
          void refresh();
        }}
      />
    );
  }

  return (
    <main className="home">
      <h1 className="home__logo">Readoza</h1>
      <p className="home__tagline">
        Read a Telegram channel like a book. Start at post one, continue where you left off.
      </p>

      <AddChannel
        repo={repo}
        source={source}
        onAdded={(channel) => {
          void refresh().then(() => open(channel));
        }}
      />

      <ChannelList
        repo={repo}
        channels={channels}
        onOpen={(channel) => void open(channel)}
        onRemove={(channel) => {
          void repo.removeChannel(channel.id).then(refresh);
        }}
      />
    </main>
  );
}
