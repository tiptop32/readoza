import type { Channel, Progress, Repo } from "./types.js";
import { readFrontier } from "./types.js";

export interface SyncSnapshot { channels: Channel[]; progress: Record<string, Progress> }
export interface SyncSession { nickname: string; code: string }
type SyncOp =
  | { kind: "channel"; channel: Channel }
  | { kind: "progress"; progress: Progress }
  | { kind: "remove"; channelId: string };
const SESSION_KEY = "readoza-sync-session";
const PENDING_KEY = "sync.pending.v1";
const EMPTY: SyncSnapshot = { channels: [], progress: {} };
const NICKNAME = /^[a-z0-9_-]{3,32}$/;
const CODE = /^[0-9a-f]{32}$/;

export function validNickname(nickname: string): boolean { return NICKNAME.test(nickname); }
export function getSyncSession(): SyncSession | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && "nickname" in value && "code" in value &&
      typeof value.nickname === "string" && typeof value.code === "string" &&
      validNickname(value.nickname) && CODE.test(value.code)) return { nickname: value.nickname, code: value.code };
  } catch { /* A damaged or blocked localStorage starts in guest mode. */ }
  return undefined;
}
export function setSyncSession(session: SyncSession | undefined): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}
export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function accountDbName(nickname: string): string {
  if (!validNickname(nickname)) throw new Error("Invalid nickname");
  return `readoza-account-${nickname}`;
}

export async function snapshotRepo(repo: Repo): Promise<SyncSnapshot> {
  const channels = await repo.listChannels();
  const progress: Record<string, Progress> = {};
  await Promise.all(channels.map(async (channel) => {
    const value = await repo.getProgress(channel.id);
    if (value) progress[channel.id] = value;
  }));
  return { channels, progress };
}

function mergeProgress(remote: Progress | undefined, local: Progress): Progress {
  if (!remote) return local;
  const latest = remote.lastReadAt > local.lastReadAt ? remote : local;
  return {
    ...latest,
    furthestReadId: Math.max(readFrontier(remote), readFrontier(local)),
    startedAt: remote.startedAt < local.startedAt ? remote.startedAt : local.startedAt,
  };
}

function opChannelId(op: SyncOp): string {
  if (op.kind === "channel") return op.channel.id;
  if (op.kind === "progress") return op.progress.channelId;
  return op.channelId;
}

export function applyOps(remote: SyncSnapshot, ops: SyncOp[]): SyncSnapshot {
  const channels = new Map(remote.channels.map((channel) => [channel.id, channel]));
  const progress = { ...remote.progress };
  for (const op of ops) {
    if (op.kind === "channel") channels.set(op.channel.id, op.channel);
    else if (op.kind === "remove") { channels.delete(op.channelId); delete progress[op.channelId]; }
    else if (channels.has(op.progress.channelId)) {
      progress[op.progress.channelId] = mergeProgress(progress[op.progress.channelId], op.progress);
    }
  }
  return { channels: [...channels.values()], progress };
}

async function applyToRepo(repo: Repo, snapshot: SyncSnapshot): Promise<void> {
  const current = new Map((await repo.listChannels()).map((channel) => [channel.id, channel]));
  const wanted = new Set(snapshot.channels.map((channel) => channel.id));
  for (const id of current.keys()) if (!wanted.has(id)) await repo.removeChannel(id);
  for (const remote of snapshot.channels) {
    const cached = current.get(remote.id);
    const hasPosts = cached && (await repo.countPosts(remote.id)) > 0;
    if (hasPosts) {
      const channel: Channel = { ...remote, importState: cached.importState };
      if (cached.importCursor) channel.importCursor = cached.importCursor;
      else delete channel.importCursor;
      if (cached.postCount !== undefined) channel.postCount = cached.postCount;
      else delete channel.postCount;
      await repo.putChannel(channel);
    } else {
      const channel: Channel = { ...remote, importState: "none" };
      delete channel.importCursor;
      delete channel.postCount;
      await repo.putChannel(channel);
    }
  }
  for (const value of Object.values(snapshot.progress)) await repo.setProgress(value);
}

export async function migrateGuest(guest: Repo, account: Repo): Promise<void> {
  const snapshot = await snapshotRepo(guest);
  for (const channel of snapshot.channels) {
    await account.putChannel(channel);
    let fromId = 0;
    while (true) {
      const batch = await guest.getPosts(channel.id, { fromId, limit: 200 });
      if (batch.length === 0) break;
      await account.putPosts(channel.id, batch);
      fromId = batch[batch.length - 1]!.id + 1;
    }
    const progress = snapshot.progress[channel.id];
    if (progress) await account.setProgress(progress);
  }
}

interface RemoteState { revision: number; snapshot: SyncSnapshot; created?: boolean }
export class SyncClient {
  readonly repo: Repo;
  private revision = 0;
  private remote: SyncSnapshot = EMPTY;
  private pending: SyncOp[] = [];
  private pendingWrite: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;
  private interval?: number;
  private debounce?: number;
  private inFlight?: Promise<void>;
  private onChanged: () => void = () => {};
  private onStatus: (status: string) => void = () => {};

  constructor(private readonly local: Repo, private readonly session: SyncSession, private readonly url: string) {
    this.ready = local.getSetting<SyncOp[]>(PENDING_KEY).then((ops) => { this.pending = Array.isArray(ops) ? ops : []; });
    this.repo = {
      ...local,
      putChannel: async (channel) => { await local.putChannel(channel); await this.enqueue({ kind: "channel", channel }); },
      removeChannel: async (id) => { await local.removeChannel(id); await this.enqueue({ kind: "remove", channelId: id }); },
      setProgress: async (progress) => { await local.setProgress(progress); await this.enqueue({ kind: "progress", progress }); },
    };
  }

  private async enqueue(op: SyncOp): Promise<void> {
    this.pendingWrite = this.pendingWrite.then(async () => {
      await this.ready;
      const id = opChannelId(op);
      if (op.kind === "remove") this.pending = this.pending.filter((item) => opChannelId(item) !== id);
      else this.pending = this.pending.filter((item) => !(item.kind === op.kind && opChannelId(item) === id));
      this.pending.push(op);
      await this.local.setSetting(PENDING_KEY, this.pending);
      this.schedule();
    });
    await this.pendingWrite;
  }

  private schedule(): void {
    if (this.debounce !== undefined) clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => void this.flush().catch(() => this.onStatus("Ожидает подключения")), 1500);
  }
  private async request(path: string, data: object): Promise<Response> {
    return fetch(`${this.url.replace(/\/$/, "")}/v1/sync/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
  }
  private async login(): Promise<RemoteState> {
    const response = await this.request("login", this.session);
    if (!response.ok) throw new Error(response.status === 401 ? "Неверный код" : "Синхронизация недоступна");
    return response.json() as Promise<RemoteState>;
  }
  async pull(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    await this.ready;
    await this.pendingWrite;
    const state = await this.login();
    this.revision = state.revision;
    this.remote = state.snapshot;
    await applyToRepo(this.local, applyOps(this.remote, this.pending));
    this.onChanged();
    if (this.pending.length) await this.flush();
    else this.onStatus("Синхронизировано");
  }
  async flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.flushPending().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  private async flushPending(): Promise<void> {
    await this.ready;
    await this.pendingWrite;
    let attempts = 0;
    while (this.pending.length) {
      if (++attempts > 8) throw new Error("Слишком много конфликтов синхронизации");
      const batch = [...this.pending];
      const snapshot = applyOps(this.remote, batch);
      const response = await this.request("save", {
        ...this.session, baseRevision: this.revision, snapshot,
      });
      if (response.status === 409) {
        const latest = await response.json() as RemoteState;
        this.revision = latest.revision;
        this.remote = latest.snapshot;
        await applyToRepo(this.local, applyOps(this.remote, this.pending));
        this.onChanged();
        continue;
      }
      if (!response.ok) throw new Error(response.status === 401 ? "Неверный код" : "Синхронизация недоступна");
      const saved = await response.json() as { revision: number };
      this.revision = saved.revision;
      this.remote = snapshot;
      const submitted = new Set(batch);
      this.pending = this.pending.filter((op) => !submitted.has(op));
      await this.local.setSetting(PENDING_KEY, this.pending);
      this.onStatus("Синхронизировано");
    }
  }
  start(onChanged: () => void, onStatus: (status: string) => void): void {
    this.onChanged = onChanged;
    this.onStatus = onStatus;
    void this.pull().catch((error: unknown) => this.onStatus(error instanceof Error ? error.message : "Синхронизация недоступна"));
    this.interval = window.setInterval(() => {
      void this.pull().catch(() => this.onStatus("Ожидает подключения"));
    }, 20_000);
  }
  stop(): void {
    if (this.interval !== undefined) clearInterval(this.interval);
    if (this.debounce !== undefined) clearTimeout(this.debounce);
  }
}
