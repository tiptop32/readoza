import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdbRepo } from "./idb.js";
import { accountDbName, SyncClient, type SyncSnapshot } from "./sync.js";
import type { Channel, Progress } from "./types.js";

const channel: Channel = {
  id: "telegram-public:news", source: "telegram-public", username: "news", title: "News",
  importState: "none", addedAt: "2026-01-01T00:00:00.000Z", firstPostId: 1, lastPostId: 100,
};
const progress = (id: number, day: number): Progress => ({
  channelId: channel.id, lastReadId: id, furthestReadId: id,
  lastReadAt: `2026-01-0${day}T00:00:00.000Z`, startedAt: "2026-01-01T00:00:00.000Z",
});
const session = { nickname: "reader", code: "0123456789abcdef0123456789abcdef" };
let number = 0;
function fakeServer() {
  let revision = 0;
  let snapshot: SyncSnapshot = { channels: [], progress: {} };
  let offline = false;
  const fetcher = vi.fn(async (_url: string, init: RequestInit): Promise<Response> => {
    if (offline) throw new TypeError("offline");
    const body = JSON.parse(String(init.body)) as {
      nickname: string; code: string; baseRevision?: number; snapshot?: SyncSnapshot;
    };
    if (body.nickname !== session.nickname || body.code !== session.code) return Response.json({ error: "invalid credentials" }, { status: 401 });
    if (_url.endsWith("/login")) return Response.json({ revision, snapshot });
    if (body.baseRevision !== revision) return Response.json({ revision, snapshot }, { status: 409 });
    revision += 1;
    snapshot = structuredClone(body.snapshot!);
    return Response.json({ revision });
  });
  return {
    fetcher,
    snapshot: () => snapshot,
    setOffline: (value: boolean) => { offline = value; },
    saveCalls: () => fetcher.mock.calls.filter(([url]) => url.endsWith("/save")).length,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("two-device sync", () => {
  it("transfers channels and progress, then propagates deletion without resurrection", async () => {
    number += 1;
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetcher);
    const aRepo = await createIdbRepo(`sync-a-${number}`);
    const bRepo = await createIdbRepo(`sync-b-${number}`);
    const a = new SyncClient(aRepo, session, "https://sync.test");
    const b = new SyncClient(bRepo, session, "https://sync.test");
    try {
      await a.pull();
      await a.repo.putChannel(channel);
      await a.repo.setProgress(progress(7, 2));
      await a.flush();
      await b.pull();
      expect((await b.repo.listChannels()).map((item) => item.id)).toEqual([channel.id]);
      expect((await b.repo.getProgress(channel.id))?.lastReadId).toBe(7);
      await b.repo.removeChannel(channel.id);
      await b.flush();
      await a.pull();
      expect(await a.repo.listChannels()).toEqual([]);
      expect(server.snapshot().channels).toEqual([]);
      const saves = server.saveCalls();
      await a.pull();
      expect(server.saveCalls()).toBe(saves);
    } finally { a.stop(); b.stop(); aRepo.close(); bRepo.close(); }
  });

  it("keeps offline edits through a revision conflict and retries them on reconnect", async () => {
    number += 1;
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetcher);
    const aRepo = await createIdbRepo(`sync-c-${number}`);
    const bRepo = await createIdbRepo(`sync-d-${number}`);
    const a = new SyncClient(aRepo, session, "https://sync.test");
    const b = new SyncClient(bRepo, session, "https://sync.test");
    try {
      await a.pull(); await b.pull();
      await a.repo.putChannel(channel); await a.flush();
      await b.repo.putChannel(channel); await b.repo.setProgress(progress(5, 2));
      server.setOffline(true);
      await expect(b.flush()).rejects.toThrow();
      server.setOffline(false);
      await a.repo.setProgress(progress(9, 3)); await a.flush();
      await b.flush();
      await a.pull();
      expect((await a.repo.getProgress(channel.id))?.lastReadId).toBe(9);
      expect((await a.repo.getProgress(channel.id))?.furthestReadId).toBe(9);
      expect(server.snapshot().progress[channel.id]?.furthestReadId).toBe(9);
    } finally { a.stop(); b.stop(); aRepo.close(); bRepo.close(); }
  });

  it("keeps local databases separate by nickname", async () => {
    number += 1;
    const first = await createIdbRepo(`${accountDbName("alice")}-${number}`);
    const second = await createIdbRepo(`${accountDbName("bob")}-${number}`);
    try {
      await first.putChannel(channel);
      expect(await second.listChannels()).toEqual([]);
    } finally { first.close(); second.close(); }
  });
});
