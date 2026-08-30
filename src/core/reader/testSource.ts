import type { ChannelMeta, Cursor, Page, Post } from "../model.js";
import type { Source } from "../source/types.js";

/**
 * Синтетический источник для тестов слоёв выше парсера.
 * Повторяет поведение Telegram, важное для читалки: окна фиксированного размера,
 * пропуски в id и курсоры, которые отдаёт сам источник.
 */

export function fakePost(channel: string, id: number): Post {
  return {
    channel,
    id,
    date: new Date(Date.UTC(2021, 0, 1) + id * 86_400_000).toISOString(),
    html: `<b>пост ${id}</b>`,
    text: `пост ${id}`,
    media: [],
    albumIds: [],
    isService: false,
    reactions: [],
  };
}

export interface FakeSourceOptions {
  pageSize?: number;
  /** Что отдаёт fetchMeta. null означает «канала нет». */
  meta?: ChannelMeta | null;
  /** Источник, который всегда возвращает тот же курсор: лента не двигается. */
  stuck?: boolean;
  /** Канонический username, отличный от запрошенного: эмуляция алиаса. */
  canonical?: string;
  /** Счётчик запросов, чтобы тесты могли проверить их количество. */
  calls?: Cursor[];
}

export function makeFakeSource(
  username: string,
  ids: number[],
  options: FakeSourceOptions = {},
): Source {
  const { pageSize = 5, stuck = false, canonical = username, calls } = options;
  const meta: ChannelMeta | null =
    options.meta === undefined ? { username, title: `Канал ${username}` } : options.meta;

  return {
    id: "fake",
    match: (input) => input.replace(/^.*\//, "").replace(/^@/, "") || null,
    fetchMeta: async () => meta,
    fetchPage: async (_channel: string, cursor: Cursor): Promise<Page> => {
      calls?.push(cursor);

      let from = 0;
      if (cursor.kind === "end") {
        from = Math.max(0, ids.length - pageSize);
      } else if (cursor.kind === "after") {
        const found = ids.findIndex((id) => id > cursor.id);
        from = found === -1 ? ids.length : found;
      } else if (cursor.kind === "before") {
        const before = ids.filter((id) => id < cursor.id);
        from = Math.max(0, before.length - pageSize);
        if (before.length === 0) return { channel: canonical, posts: [] };
      }

      const slice = ids.slice(from, from + pageSize);
      const page: Page = { channel: canonical, posts: slice.map((id) => fakePost(canonical, id)) };
      const firstId = slice[0];
      const lastId = slice.at(-1);
      if (from > 0 && firstId !== undefined) page.prev = { kind: "before", id: firstId };
      if (stuck) {
        page.next = cursor.kind === "after" ? { kind: "after", id: cursor.id } : { kind: "after", id: ids[0] ?? 0 };
      } else if (from + slice.length < ids.length && lastId !== undefined) {
        page.next = { kind: "after", id: lastId };
      }
      return page;
    },
  };
}
