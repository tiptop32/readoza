import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Post } from "../model.js";
import { createIdbRepo } from "./idb.js";
import { channelId, newChannel, type Repo } from "./types.js";

const CHANNEL = channelId("telegram-public", "sys_sa");

function post(id: number, date = `2021-08-${String((id % 28) + 1).padStart(2, "0")}T10:00:00+00:00`): Post {
  return {
    channel: "sys_sa",
    id,
    date,
    html: `<b>пост ${id}</b>`,
    text: `пост ${id}`,
    media: [],
    albumIds: [],
    isService: false,
    reactions: [],
  };
}

let repo: Repo;
let dbCounter = 0;

beforeEach(async () => {
  dbCounter += 1;
  repo = await createIdbRepo(`readoza-test-${dbCounter}`);
  await repo.putChannel(
    newChannel("telegram-public", { username: "sys_sa", title: "Системный Аналитик" }),
  );
});

describe("каналы", () => {
  it("сохраняет и читает канал", async () => {
    const channel = await repo.getChannel(CHANNEL);
    expect(channel?.username).toBe("sys_sa");
    expect(channel?.importState).toBe("none");
  });

  it("сортирует список по последнему открытию", async () => {
    const other = newChannel("telegram-public", { username: "tginfo", title: "Telegram Info" });
    other.lastOpenedAt = "2030-01-01T00:00:00.000Z";
    await repo.putChannel(other);
    const list = await repo.listChannels();
    expect(list[0]?.username).toBe("tginfo");
  });
});

describe("посты", () => {
  beforeEach(async () => {
    await repo.putPosts(CHANNEL, [1, 2, 4, 5, 8, 13, 21].map((id) => post(id)));
  });

  it("хранит посты и считает их количество", async () => {
    expect(await repo.countPosts(CHANNEL)).toBe(7);
    expect((await repo.getPost(CHANNEL, 8))?.text).toBe("пост 8");
    expect(await repo.getPost(CHANNEL, 3)).toBeUndefined();
  });

  it("отдаёт посты в порядке чтения", async () => {
    const ids = (await repo.getPosts(CHANNEL)).map((p) => p.id);
    expect(ids).toEqual([1, 2, 4, 5, 8, 13, 21]);
  });

  it("отдаёт окно от позиции чтения", async () => {
    const window = await repo.getPosts(CHANNEL, { fromId: 5, limit: 3 });
    expect(window.map((p) => p.id)).toEqual([5, 8, 13]);
  });

  it("умеет идти назад", async () => {
    const back = await repo.getPosts(CHANNEL, { toId: 8, limit: 2, direction: "backward" });
    expect(back.map((p) => p.id)).toEqual([8, 5]);
  });

  it("считает прочитанное до позиции", async () => {
    // позиция может указывать на удалённый id, диапазон это переживает
    expect(await repo.countPosts(CHANNEL, 8)).toBe(5);
    expect(await repo.countPosts(CHANNEL, 9)).toBe(5);
    expect(await repo.countPosts(CHANNEL, 100)).toBe(7);
  });

  it("повторная запись того же поста не создаёт дубликат", async () => {
    await repo.putPosts(CHANNEL, [post(1), post(2)]);
    expect(await repo.countPosts(CHANNEL)).toBe(7);
  });

  it("не смешивает посты разных каналов", async () => {
    const other = channelId("telegram-public", "tginfo");
    await repo.putPosts(other, [post(1), post(2)]);
    expect(await repo.countPosts(CHANNEL)).toBe(7);
    expect(await repo.countPosts(other)).toBe(2);
  });
});

describe("прогресс и закладки", () => {
  it("хранит позицию чтения", async () => {
    await repo.setProgress({
      channelId: CHANNEL,
      lastReadId: 214,
      lastReadAt: "2026-08-30T10:00:00.000Z",
      startedAt: "2026-08-01T10:00:00.000Z",
    });
    expect((await repo.getProgress(CHANNEL))?.lastReadId).toBe(214);
  });

  it("хранит закладки по каналам", async () => {
    await repo.putBookmark({ channelId: CHANNEL, postId: 42, createdAt: "2026-08-30T10:00:00Z" });
    await repo.putBookmark({ channelId: CHANNEL, postId: 7, createdAt: "2026-08-30T10:00:00Z" });
    expect((await repo.listBookmarks(CHANNEL)).map((b) => b.postId)).toEqual([7, 42]);
    await repo.removeBookmark(CHANNEL, 7);
    expect(await repo.listBookmarks(CHANNEL)).toHaveLength(1);
  });
});

describe("настройки", () => {
  it("хранит произвольные значения", async () => {
    await repo.setSetting("proxyUrl", "https://proxy.example/tg");
    expect(await repo.getSetting<string>("proxyUrl")).toBe("https://proxy.example/tg");
    expect(await repo.getSetting<string>("нет-такого")).toBeUndefined();
  });
});

describe("удаление канала", () => {
  it("уносит с собой посты, прогресс и закладки", async () => {
    await repo.putPosts(CHANNEL, [post(1), post(2)]);
    await repo.setProgress({
      channelId: CHANNEL,
      lastReadId: 2,
      lastReadAt: "2026-08-30T10:00:00Z",
      startedAt: "2026-08-30T10:00:00Z",
    });
    await repo.putBookmark({ channelId: CHANNEL, postId: 1, createdAt: "2026-08-30T10:00:00Z" });

    await repo.removeChannel(CHANNEL);

    expect(await repo.getChannel(CHANNEL)).toBeUndefined();
    expect(await repo.countPosts(CHANNEL)).toBe(0);
    expect(await repo.getProgress(CHANNEL)).toBeUndefined();
    expect(await repo.listBookmarks(CHANNEL)).toHaveLength(0);
  });
});
