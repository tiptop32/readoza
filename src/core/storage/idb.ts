import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Post } from "../model.js";
import type { Bookmark, Channel, PostQuery, Progress, Repo, StoredPost } from "./types.js";

/**
 * IndexedDB выбран потому, что он одинаково работает в браузере, в webview Capacitor
 * и в webview Tauri, без единого платформенного плагина. SQLite дал бы SQL и FTS,
 * но потребовал бы три разных драйвера, а поиска в v0.1 нет.
 */

export const DB_NAME = "readoza";
const DB_VERSION = 1;

interface ReadozaDB extends DBSchema {
  channels: { key: string; value: Channel };
  posts: {
    key: [string, number];
    value: StoredPost;
    indexes: { "by-channel-date": [string, string] };
  };
  progress: { key: string; value: Progress };
  bookmarks: {
    key: [string, number];
    value: Bookmark;
    indexes: { "by-channel": string };
  };
  settings: { key: string; value: unknown };
}

function openReadozaDB(name: string): Promise<IDBPDatabase<ReadozaDB>> {
  return openDB<ReadozaDB>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore("channels", { keyPath: "id" });

      const posts = db.createObjectStore("posts", { keyPath: ["channelId", "id"] });
      posts.createIndex("by-channel-date", ["channelId", "date"]);

      db.createObjectStore("progress", { keyPath: "channelId" });

      const bookmarks = db.createObjectStore("bookmarks", { keyPath: ["channelId", "postId"] });
      bookmarks.createIndex("by-channel", "channelId");

      db.createObjectStore("settings");
    },
  });
}

/** id сообщений начинаются с 1, поэтому нижняя граница диапазона безопасна. */
const MIN_ID = 0;
const MAX_ID = Number.MAX_SAFE_INTEGER;

function postRange(channelId: string, query: PostQuery = {}): IDBKeyRange {
  return IDBKeyRange.bound(
    [channelId, query.fromId ?? MIN_ID],
    [channelId, query.toId ?? MAX_ID],
  );
}

export async function createIdbRepo(name: string = DB_NAME): Promise<Repo> {
  const db = await openReadozaDB(name);

  return {
    async putChannel(channel) {
      await db.put("channels", channel);
    },

    async getChannel(id) {
      return db.get("channels", id);
    },

    async listChannels() {
      const channels = await db.getAll("channels");
      // Самые свежие по чтению сверху: экран «продолжить чтение» именно так и выглядит.
      return channels.sort((a, b) =>
        (b.lastOpenedAt ?? b.addedAt).localeCompare(a.lastOpenedAt ?? a.addedAt),
      );
    },

    async removeChannel(id) {
      const tx = db.transaction(["channels", "posts", "progress", "bookmarks"], "readwrite");
      await tx.objectStore("channels").delete(id);
      await tx.objectStore("progress").delete(id);
      await tx.objectStore("posts").delete(postRange(id));
      await tx.objectStore("bookmarks").delete(IDBKeyRange.bound([id, MIN_ID], [id, MAX_ID]));
      await tx.done;
    },

    async putPosts(channelId, posts: Post[], fetchedAt = new Date().toISOString()) {
      if (posts.length === 0) return;
      const tx = db.transaction("posts", "readwrite");
      const store = tx.objectStore("posts");
      await Promise.all(posts.map((post) => store.put({ ...post, channelId, fetchedAt })));
      await tx.done;
    },

    async getPosts(channelId, query = {}) {
      const range = postRange(channelId, query);
      const backward = query.direction === "backward";
      if (query.limit === undefined) {
        const all = await db.getAll("posts", range);
        return backward ? all.reverse() : all;
      }
      // Курсор вместо getAll: подгрузка окна не должна поднимать канал целиком.
      const out: StoredPost[] = [];
      let cursor = await db
        .transaction("posts")
        .objectStore("posts")
        .openCursor(range, backward ? "prev" : "next");
      while (cursor && out.length < query.limit) {
        out.push(cursor.value);
        cursor = await cursor.continue();
      }
      return out;
    },

    async getPost(channelId, postId) {
      return db.get("posts", [channelId, postId]);
    },

    async countPosts(channelId, upToId) {
      return db.count("posts", postRange(channelId, upToId === undefined ? {} : { toId: upToId }));
    },

    async getProgress(channelId) {
      return db.get("progress", channelId);
    },

    async setProgress(progress) {
      await db.put("progress", progress);
    },

    async putBookmark(bookmark) {
      await db.put("bookmarks", bookmark);
    },

    async removeBookmark(channelId, postId) {
      await db.delete("bookmarks", [channelId, postId]);
    },

    async listBookmarks(channelId) {
      const all =
        channelId === undefined
          ? await db.getAll("bookmarks")
          : await db.getAllFromIndex("bookmarks", "by-channel", channelId);
      return all.sort((a, b) => a.channelId.localeCompare(b.channelId) || a.postId - b.postId);
    },

    async getSetting<T>(key: string) {
      return (await db.get("settings", key)) as T | undefined;
    },

    async setSetting<T>(key: string, value: T) {
      await db.put("settings", value, key);
    },

    close() {
      db.close();
    },
  };
}
