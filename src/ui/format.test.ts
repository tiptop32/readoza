import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDay,
  formatLastRead,
  formatMonth,
  formatPercent,
  formatSpan,
} from "./format.js";

describe("даты", () => {
  it("форматирует день и месяц", () => {
    expect(formatDay("2021-08-14T12:00:00+00:00")).toBe("14 August 2021");
    expect(formatMonth("2021-08-14T12:00:00+00:00")).toBe("August 2021");
  });

  it("переживает отсутствующую и битую дату", () => {
    expect(formatDay(undefined)).toBe("");
    expect(formatDay("")).toBe("");
    expect(formatDay("не дата")).toBe("");
    expect(formatMonth("не дата")).toBe("");
  });

  it("склеивает диапазон жизни канала", () => {
    expect(formatSpan("2021-08-14T12:00:00Z", "2026-08-14T12:00:00Z")).toBe(
      "August 2021 — August 2026",
    );
    // канал прожил один месяц: диапазон схлопывается
    expect(formatSpan("2021-08-14T12:00:00Z", "2021-08-28T12:00:00Z")).toBe("August 2021");
    expect(formatSpan(undefined, undefined)).toBe("");
    expect(formatSpan(undefined, "2026-08-14T12:00:00Z")).toBe("August 2026");
  });
});

describe("числа", () => {
  it("округляет проценты и зажимает их в границы", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(41.6)).toBe("42%");
    expect(formatPercent(-5)).toBe("0%");
    expect(formatPercent(140)).toBe("100%");
  });

  it("расставляет разряды", () => {
    expect(formatCount(1842)).toBe("1,842");
    expect(formatCount(0)).toBe("0");
  });
});

describe("formatLastRead", () => {
  const now = new Date("2026-08-30T12:00:00Z");

  // Сравнение идёт по местным календарным суткам, поэтому проверки берут
  // ровно кратные суткам отступы: иначе тест зависел бы от часового пояса машины.
  it("называет сегодня и вчера словами", () => {
    expect(formatLastRead(now.toISOString(), now)).toBe("today");
    expect(formatLastRead("2026-08-29T12:00:00Z", now)).toBe("yesterday");
  });

  it("считает дни на прошлой неделе", () => {
    expect(formatLastRead("2026-08-27T12:00:00Z", now)).toBe("3 days ago");
  });

  it("дальше семи дней показывает дату", () => {
    expect(formatLastRead("2026-08-01T12:00:00Z", now)).toBe("1 August 2026");
  });

  it("переживает отсутствие даты", () => {
    expect(formatLastRead(undefined, now)).toBe("");
  });
});
