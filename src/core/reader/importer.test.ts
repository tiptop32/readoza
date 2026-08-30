import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createIdbRepo } from "../storage/idb.js";
import { channelId, newChannel, type Repo } from "../storage/types.js";
import { importChannel, type ImportProgress } from "./importer.js";
import { makeFakeSource } from "./testSource.js";

const CHANNEL = channelId("fake", "sys_sa");
// 23 поста с пропусками: удалённые id не должны ломать обход
const IDS = [1, 2, 4, 5, 8, 13, 21, 34, 55, 89, 90, 91, 95, 100, 101, 102, 110, 120, 121, 130, 140, 141, 150];

const noSleep = async (): Promise<void> => {};

let repo: Repo;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  repo = await createIdbRepo(`readoza-import-${counter}`);
  const channel = newChannel("fake", { username: "sys_sa", title: "Канал" });
  await repo.putChannel(channel);
});

describe("importChannel", () => {
  it("выкачивает канал целиком и помечает его завершённым", async () => {
    const source = makeFakeSource("sys_sa", IDS);
    const result = await importChannel(repo, source, CHANNEL, { sleep: noSleep });

    expect(result.done).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.posts).toBe(IDS.length);
    expect(result.pages).toBe(Math.ceil(IDS.length / 5));

    const channel = await repo.getChannel(CHANNEL);
    expect(channel?.importState).toBe("complete");
    expect(channel?.postCount).toBe(IDS.length);
    expect(channel?.importCursor).toBeUndefined();
    expect(channel?.firstPostId).toBe(1);
    expect(channel?.lastPostId).toBe(150);
    expect(await repo.countPosts(CHANNEL)).toBe(IDS.length);
  });

  it("запоминает курсор и продолжает с того же места после остановки", async () => {
    const source = makeFakeSource("sys_sa", IDS);
    const controller = new AbortController();

    const first = await importChannel(repo, source, CHANNEL, {
      sleep: noSleep,
      signal: controller.signal,
      onProgress: (p: ImportProgress) => {
        if (p.pages >= 2) controller.abort();
      },
    });
    expect(first.aborted).toBe(true);
    expect(first.done).toBe(false);

    const midway = await repo.getChannel(CHANNEL);
    expect(midway?.importState).toBe("partial");
    expect(midway?.importCursor).toBeDefined();
    const savedSoFar = await repo.countPosts(CHANNEL);
    expect(savedSoFar).toBeGreaterThan(0);
    expect(savedSoFar).toBeLessThan(IDS.length);

    const second = await importChannel(repo, source, CHANNEL, { sleep: noSleep });
    expect(second.done).toBe(true);
    // Ни одного дубля и ни одного потерянного поста после возобновления.
    expect(await repo.countPosts(CHANNEL)).toBe(IDS.length);
    expect((await repo.getChannel(CHANNEL))?.importState).toBe("complete");
  });

  it("не перекачивает уже завершённый канал", async () => {
    const calls: unknown[] = [];
    const source = makeFakeSource("sys_sa", IDS, { calls: calls as never });
    await importChannel(repo, source, CHANNEL, { sleep: noSleep });
    const after = calls.length;

    const again = await importChannel(repo, source, CHANNEL, { sleep: noSleep });
    expect(again.done).toBe(true);
    expect(again.pages).toBe(0);
    expect(calls.length).toBe(after);
  });

  it("останавливается, если лента перестала двигаться", async () => {
    const source = makeFakeSource("sys_sa", IDS, { stuck: true });
    const result = await importChannel(repo, source, CHANNEL, { sleep: noSleep, maxPages: 50 });
    // Курсор повторился, значит идти дальше некуда: выходим, а не крутимся вечно.
    expect(result.pages).toBeLessThan(50);
    expect(result.done).toBe(true);
  });

  it("уважает предохранитель по числу страниц", async () => {
    const many = Array.from({ length: 500 }, (_, i) => i + 1);
    const source = makeFakeSource("sys_sa", many, { pageSize: 5 });
    const result = await importChannel(repo, source, CHANNEL, { sleep: noSleep, maxPages: 3 });
    expect(result.pages).toBe(3);
    expect(result.done).toBe(false);
    expect((await repo.getChannel(CHANNEL))?.importState).toBe("partial");
  });

  it("сообщает о ходе работы", async () => {
    const seen: number[] = [];
    const source = makeFakeSource("sys_sa", IDS);
    await importChannel(repo, source, CHANNEL, {
      sleep: noSleep,
      onProgress: (p) => seen.push(p.posts),
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(IDS.length);
  });

  it("падает на неизвестном канале", async () => {
    const source = makeFakeSource("sys_sa", IDS);
    await expect(importChannel(repo, source, "fake:нет-такого", { sleep: noSleep })).rejects.toThrow(
      /канал не найден/,
    );
  });
});
