import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { touchChannel } from "../core/reader/library.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Repo } from "../core/storage/types.js";
import type { SyncClient } from "../core/storage/sync.js";
import { SyncAccount } from "./SyncAccount.js";
import { AddChannel } from "./AddChannel.js";
import { ChannelList } from "./ChannelList.js";
import { Reader } from "./Reader.js";

export function App({ repo, source, syncClient }: { repo: Repo; source: Source; syncClient?: SyncClient }): ReactElement {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [syncStatus, setSyncStatus] = useState("Подключение…");

  const refresh = useCallback(async () => {
    setChannels(await repo.listChannels());
  }, [repo]);

  useEffect(() => {
    void refresh();
    if (!syncClient) return;
    syncClient.start(() => void refresh(), setSyncStatus);
    return () => syncClient.stop();
  }, [refresh, syncClient]);

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

      <SyncAccount repo={repo} client={syncClient} status={syncStatus} />

      <AddChannel
        repo={repo}
        source={source}
        onAdded={(channel) => {
          void refresh().then(() => open(channel));
        }}
      />

      <ChannelList
        repo={repo}
        source={source}
        channels={channels}
        onOpen={(channel) => void open(channel)}
        onRemove={(channel) => {
          void repo.removeChannel(channel.id).then(refresh);
        }}
        onChanged={() => void refresh()}
      />
    </main>
  );
}
