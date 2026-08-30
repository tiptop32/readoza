/**
 * Форматирование для интерфейса.
 *
 * Дата это главный ориентир в читалке: «август 2021 из августа 2026» человеку
 * понятнее, чем «12%», и, в отличие от процента, не врёт при неравномерных
 * пропусках в id.
 */

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

function parse(iso: string | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «14 August 2021». Пустая строка, если даты нет. */
export function formatDay(iso: string | undefined): string {
  const date = parse(iso);
  return date ? DAY.format(date) : "";
}

/** «August 2021». Компактный ориентир для шапки читалки. */
export function formatMonth(iso: string | undefined): string {
  const date = parse(iso);
  return date ? MONTH.format(date) : "";
}

/** Диапазон жизни канала: «August 2021 — today». */
export function formatSpan(fromIso: string | undefined, toIso: string | undefined): string {
  const from = formatMonth(fromIso);
  const to = formatMonth(toIso);
  if (!from && !to) return "";
  if (!from) return to;
  if (!to || from === to) return from;
  return `${from} — ${to}`;
}

/** Целые проценты без ложной точности. */
export function formatPercent(percent: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  return `${Math.round(clamped)}%`;
}

/** «1,842» — разряды, чтобы длинные каналы читались с одного взгляда. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** Отметка последнего чтения: «today», «yesterday», иначе дата. */
export function formatLastRead(iso: string | undefined, now: Date = new Date()): string {
  const date = parse(iso);
  if (!date) return "";
  const days = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) /
      86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDay(iso);
}
