import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeSource } from "../core/reader/testSource.js";
import { createIdbRepo } from "../core/storage/idb.js";
import type { Repo } from "../core/storage/types.js";
import { App } from "./App.js";

const IDS = [1, 2, 4, 5, 8, 13, 21];

beforeAll(() => {
  // jsdom не реализует ни то, ни другое, а читалка опирается на оба.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

let repo: Repo;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  repo = await createIdbRepo(`readoza-ui-${counter}`);
});

describe("поток целиком", () => {
  it("от пустого экрана до чтения канала с первого поста", async () => {
    const user = userEvent.setup();
    render(<App repo={repo} source={makeFakeSource("sys_sa", IDS)} />);

    expect(screen.getByRole("heading", { name: "Readoza" })).toBeDefined();

    await user.type(screen.getByLabelText("Telegram channel"), "t.me/sys_sa");

    // Карточка канала появляется до добавления: это и есть замена поиску.
    const start = await screen.findByRole("button", { name: /start from the beginning/i }, {
      timeout: 3000,
    });
    expect(screen.getByText("Канал sys_sa")).toBeDefined();

    await user.click(start);

    // Читалка открылась с первого поста, посты идут по возрастанию.
    await waitFor(() => expect(screen.getByText("пост 1")).toBeDefined());
    const rendered = document.querySelectorAll("[data-post-id]");
    const ids = [...rendered].map((node) => Number((node as HTMLElement).dataset["postId"]));
    expect(ids[0]).toBe(1);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("канал попадает в список и открывается заново с сохранённой позиции", async () => {
    const user = userEvent.setup();
    const source = makeFakeSource("sys_sa", IDS);
    render(<App repo={repo} source={source} />);

    await user.type(screen.getByLabelText("Telegram channel"), "sys_sa");
    await user.click(
      await screen.findByRole("button", { name: /start from the beginning/i }, { timeout: 3000 }),
    );
    await waitFor(() => expect(screen.getByText("пост 1")).toBeDefined());

    // Позиция, как будто дочитали до пятого поста.
    const channels = await repo.listChannels();
    const channel = channels[0];
    expect(channel).toBeDefined();
    await repo.setProgress({
      channelId: channel!.id,
      lastReadId: 5,
      lastReadAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    });

    await user.click(screen.getByRole("button", { name: "Back" }));

    // Якорь на начало имени: у кнопки удаления имя тоже содержит название канала.
    const entry = await screen.findByRole("button", { name: /^Канал sys_sa/ });
    // Прогресс на карточке подтягивается асинхронно, поэтому ждём, а не читаем сразу.
    expect(await screen.findByText(/posts read/)).toBeDefined();

    await user.click(entry);
    await waitFor(() => expect(screen.getByText("пост 5")).toBeDefined());
  });
});
