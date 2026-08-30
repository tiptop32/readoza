import { describe, expect, it } from "vitest";
import type { Channel, Progress } from "../storage/types.js";
import { advanceRead, describeProgress, percentByIds, setReadPosition } from "./progress.js";

const channel: Channel = {
  id: "telegram-public:sys_sa",
  source: "telegram-public",
  username: "sys_sa",
  title: "Системный Аналитик",
  firstPostId: 1,
  lastPostId: 1001,
  importState: "partial",
  addedAt: "2026-08-01T00:00:00.000Z",
};

const progress: Progress = {
  channelId: channel.id,
  lastReadId: 501,
  lastReadAt: "2026-08-30T10:00:00.000Z",
  startedAt: "2026-08-01T00:00:00.000Z",
};

describe("percentByIds", () => {
  it("считает долю пройденного диапазона id", () => {
    expect(percentByIds(1, 1001, 501)).toBeCloseTo(50, 5);
    expect(percentByIds(1, 1001, 1)).toBe(0);
    expect(percentByIds(1, 1001, 1001)).toBe(100);
  });

  it("зажимает выход за границы", () => {
    // позиция может оказаться выше известной верхней границы: канал дописали
    expect(percentByIds(1, 100, 500)).toBe(100);
    expect(percentByIds(50, 100, 10)).toBe(0);
  });

  it("не делит на ноль на канале из одного поста", () => {
    expect(percentByIds(7, 7, 7)).toBe(100);
    expect(percentByIds(7, 7, 6)).toBe(0);
  });
});

describe("advanceRead", () => {
  it("создаёт прогресс при первом чтении", () => {
    const now = new Date("2026-08-30T12:00:00.000Z");
    const p = advanceRead(undefined, channel.id, 5, now);
    expect(p.lastReadId).toBe(5);
    expect(p.startedAt).toBe(now.toISOString());
  });

  it("двигает позицию вперёд", () => {
    const p = advanceRead(progress, channel.id, 700, new Date("2026-08-30T12:00:00.000Z"));
    expect(p.lastReadId).toBe(700);
    expect(p.startedAt).toBe(progress.startedAt);
  });

  it("не откатывает позицию при перечитывании назад", () => {
    const p = advanceRead(progress, channel.id, 100, new Date("2026-08-30T12:00:00.000Z"));
    expect(p.lastReadId).toBe(501);
    expect(p.lastReadAt).toBe("2026-08-30T12:00:00.000Z");
  });
});

describe("setReadPosition", () => {
  it("переносит позицию явно, в том числе назад", () => {
    const p = setReadPosition(progress, channel.id, 10, new Date("2026-08-30T12:00:00.000Z"));
    expect(p.lastReadId).toBe(10);
    expect(p.startedAt).toBe(progress.startedAt);
  });

  it("начинает заново на чистом канале", () => {
    const now = new Date("2026-08-30T12:00:00.000Z");
    expect(setReadPosition(undefined, channel.id, 1, now).startedAt).toBe(now.toISOString());
  });
});

describe("describeProgress", () => {
  it("на нетронутом канале показывает ноль", () => {
    const view = describeProgress({ channel });
    expect(view.percent).toBe(0);
    expect(view.lastReadId).toBeUndefined();
    expect(view.totalCount).toBeUndefined();
  });

  it("считает процент по диапазону id и отдаёт дату остановки", () => {
    const view = describeProgress({
      channel,
      progress,
      readCount: 214,
      atDate: "2023-04-12T09:00:00+00:00",
    });
    expect(view.percent).toBeCloseTo(50, 5);
    expect(view.readCount).toBe(214);
    expect(view.atDate).toBe("2023-04-12T09:00:00+00:00");
  });

  it("отдаёт точный знаменатель только после полной докачки", () => {
    const partial = describeProgress({ channel, progress, readCount: 214 });
    expect(partial.totalCount).toBeUndefined();

    const complete = describeProgress({
      channel: { ...channel, importState: "complete", postCount: 1842 },
      progress,
      readCount: 214,
    });
    expect(complete.totalCount).toBe(1842);
  });

  it("падает на счёт постов, пока границы канала неизвестны", () => {
    const noBounds: Channel = {
      ...channel,
      importState: "complete",
      postCount: 400,
      firstPostId: undefined,
      lastPostId: undefined,
    };
    expect(describeProgress({ channel: noBounds, progress, readCount: 100 }).percent).toBe(25);
  });
});
