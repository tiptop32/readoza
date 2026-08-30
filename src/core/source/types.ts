import type { ChannelMeta, Cursor, Page } from "../model.js";

/**
 * Транспорт — единственное место, различающееся между платформами.
 *
 *   web      -> fetch через собственный прокси (у t.me нет CORS-заголовков)
 *   desktop  -> прямой запрос из Tauri
 *   mobile   -> прямой запрос из Capacitor
 *
 * Всё остальное в проекте общее.
 */
export type Transport = (url: string) => Promise<string>;

export interface Source {
  readonly id: string;
  /** Приводит пользовательский ввод к идентификатору канала. null — ввод не подходит источнику. */
  match(input: string): string | null;
  fetchMeta(channel: string): Promise<ChannelMeta | null>;
  fetchPage(channel: string, cursor: Cursor): Promise<Page>;
}
