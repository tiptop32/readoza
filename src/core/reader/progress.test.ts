import { describe, expect, it } from "vitest";
import type { Channel, Progress } from "../storage/types.js";
import { describeProgress, percentByIds, updateRead } from "./progress.js";

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

describe("updateRead", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");

  it("создаёт прогресс при первом чтении", () => {
    const p = updateRead(undefined, channel.id, 5, now);
    expect(p.lastReadId).toBe(5);
    expect(p.furthestReadId).toBe(5);
    expect(p.startedAt).toBe(now.toISOString());
  });

  it("двигает позицию вперёд вместе с границей", () => {
    const p = updateRead(progress, channel.id, 700, now);
    expect(p.lastReadId).toBe(700);
    expect(p.furthestReadId).toBe(700);
    expect(p.startedAt).toBe(progress.startedAt);
  });

  it("идёт назад вместе с читателем: остановился он именно там", () => {
    const p = updateRead(progress, channel.id, 100, now);
    expect(p.lastReadId).toBe(100);
    expect(p.lastReadAt).toBe(now.toISOString());
  });

  it("но границу прочитанного назад не откатывает", () => {
    const p = updateRead(progress, channel.id, 100, now);
    expect(p.furthestReadId).toBe(501);
    // и повторный проход вперёд по уже прочитанному её не ломает
    expect(updateRead(p, channel.id, 200, now).furthestReadId).toBe(501);
  });

  it("понимает записи, сделанные до появления границы", () => {
    const legacy: Progress = {
      channelId: channel.id,
      lastReadId: 900,
      lastReadAt: now.toISOString(),
      startedAt: now.toISOString(),
    };
    expect(updateRead(legacy, channel.id, 50, now).furthestReadId).toBe(900);
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

  it("считает процент по границе, а не по позиции после отлистывания назад", () => {
    // Читатель дошёл до 501 и вернулся к 100: прогресс не должен обнулиться.
    const rewound = describeProgress({
      channel,
      progress: { ...progress, lastReadId: 100, furthestReadId: 501 },
      readCount: 214,
    });
    expect(rewound.percent).toBeCloseTo(50, 5);
    expect(rewound.lastReadId).toBe(100);
    expect(rewound.furthestReadId).toBe(501);
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
