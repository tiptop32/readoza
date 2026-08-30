import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cursor } from "../model.js";
import { createIdbRepo } from "../storage/idb.js";
import type { Repo } from "../storage/types.js";
import { addChannel, channelProgress, ReadozaError, touchChannel } from "./library.js";
import { advanceRead } from "./progress.js";
import { makeFakeSource } from "./testSource.js";

const IDS = [1, 2, 4, 5, 8, 13, 21, 34, 55, 89];

let repo: Repo;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  repo = await createIdbRepo(`readoza-library-${counter}`);
});

describe("addChannel", () => {
  it("добавляет канал, находит начало и сохраняет первое окно", async () => {
    const calls: Cursor[] = [];
    const source = makeFakeSource("sys_sa", IDS, { calls });
    const channel = await addChannel(repo, source, "https://t.me/sys_sa");

    expect(channel.username).toBe("sys_sa");
    expect(channel.firstPostId).toBe(1);
    expect(channel.lastPostId).toBe(89);
    expect(channel.importState).toBe("partial");
    expect(channel.importCursor).toBeDefined();

    // Один запрос за последней страницей, один за первой.
    expect(calls.map((c) => c.kind)).toEqual(["end", "start"]);
    // Поиску начала передана уже известная верхняя граница id: без неё канал с
    // удалённой ранней историей упёрся бы в фиксированный потолок проб.
    expect(calls[1]).toEqual({ kind: "start", upTo: 89 });
    // Читать можно сразу, первое окно уже в хранилище.
    const stored = await repo.getPosts(channel.id, { limit: 5 });
    expect(stored.map((p) => p.id)).toEqual([1, 2, 4, 5, 8]);
  });

  it("берёт канонический username, а не введённый алиас", async () => {
    const source = makeFakeSource("breakingmash", IDS, { canonical: "mash" });
    const channel = await addChannel(repo, source, "https://t.me/breakingmash");
    expect(channel.username).toBe("mash");
    expect(channel.id).toBe("fake:mash");
  });

  it("помечает завершённым канал, уместившийся в одну страницу", async () => {
    const source = makeFakeSource("tiny", [1, 2, 3], { pageSize: 10 });
    const channel = await addChannel(repo, source, "@tiny");
    expect(channel.importState).toBe("complete");
    expect(channel.postCount).toBe(3);
  });

  it("отвергает мусор во вводе", async () => {
    const source = makeFakeSource("sys_sa", IDS);
    await expect(addChannel(repo, source, "")).rejects.toThrow(ReadozaError);
    await expect(addChannel(repo, source, "")).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("сообщает, что канала не существует", async () => {
    const source = makeFakeSource("нет", IDS, { meta: null });
    await expect(addChannel(repo, source, "@nosuch")).rejects.toMatchObject({ code: "not-found" });
  });

  it("отличает группу от канала по отсутствию публичной ленты", async () => {
    // у группы есть карточка, но нет ленты в t.me/s
    const source = makeFakeSource("rustlang_ru", []);
    await expect(addChannel(repo, source, "@rustlang_ru")).rejects.toMatchObject({
      code: "not-a-channel",
    });
  });
});

describe("channelProgress", () => {
  it("на свежем канале показывает ноль", async () => {
    const source = makeFakeSource("sys_sa", IDS);
    const channel = await addChannel(repo, source, "@sys_sa");
    const view = await channelProgress(repo, channel.id);
    expect(view?.percent).toBe(0);
    expect(view?.readCount).toBe(0);
  });

  it("считает позицию, дату остановки и число прочитанного", async () => {
    const source = makeFakeSource("sys_sa", IDS);
    const channel = await addChannel(repo, source, "@sys_sa");
    await repo.setProgress(advanceRead(undefined, channel.id, 5));

    const view = await channelProgress(repo, channel.id);
    expect(view?.lastReadId).toBe(5);
    expect(view?.readCount).toBe(4); // 1, 2, 4, 5
    expect(view?.atDate).toBeDefined();
    expect(view?.percent).toBeGreaterThan(0);
    expect(view?.percent).toBeLessThan(100);
  });

  it("возвращает null для неизвестного канала", async () => {
    expect(await channelProgress(repo, "fake:нет")).toBeNull();
  });
});

describe("touchChannel", () => {
  it("отмечает открытие и поднимает канал в списке", async () => {
    const first = await addChannel(repo, makeFakeSource("aaa", IDS), "@aaa");
    const second = await addChannel(repo, makeFakeSource("bbb", IDS), "@bbb");

    await touchChannel(repo, first.id, new Date("2030-01-01T00:00:00.000Z"));
    const list = await repo.listChannels();
    expect(list[0]?.id).toBe(first.id);
    expect(list[1]?.id).toBe(second.id);
  });

  it("молча игнорирует неизвестный канал", async () => {
    await expect(touchChannel(repo, "fake:нет")).resolves.toBeUndefined();
  });
});
