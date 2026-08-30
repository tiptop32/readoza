import { describe, expect, it, vi } from "vitest";
import { TransportError } from "../source/errors.js";
import { withRetry } from "./retry.js";

const noSleep = async (): Promise<void> => {};

describe("withRetry", () => {
  it("не трогает успешный вызов", async () => {
    const operation = vi.fn().mockResolvedValue("ок");
    expect(await withRetry(operation, { sleep: noSleep })).toBe("ок");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("повторяет то, что имеет смысл повторять", async () => {
    for (const error of [
      new TransportError("лимит", 429),
      new TransportError("сервер лёг", 503),
      new TransportError("сети нет"), // до сервера не дошли
      new TypeError("Failed to fetch"),
    ]) {
      const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ок");
      expect(await withRetry(operation, { sleep: noSleep }), String(error)).toBe("ок");
      expect(operation).toHaveBeenCalledTimes(2);
    }
  });

  it("не повторяет то, что повторять бессмысленно", async () => {
    for (const error of [
      new TransportError("нет такого", 404),
      new TransportError("кривой запрос", 400),
      new Error("ошибка в коде"),
    ]) {
      const operation = vi.fn().mockRejectedValue(error);
      await expect(withRetry(operation, { sleep: noSleep })).rejects.toThrow();
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it("наращивает паузу вдвое и сдаётся после последней попытки", async () => {
    const delays: number[] = [];
    const operation = vi.fn().mockRejectedValue(new TransportError("лимит", 429));

    await expect(
      withRetry(operation, {
        attempts: 4,
        baseDelayMs: 1000,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow("лимит");

    expect(operation).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it("сообщает о каждом повторе", async () => {
    const seen: Array<[number, number]> = [];
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new TransportError("лимит", 429))
      .mockResolvedValue("ок");

    await withRetry(operation, {
      sleep: noSleep,
      onRetry: (attempt, delayMs) => seen.push([attempt, delayMs]),
    });
    expect(seen).toEqual([[1, 1000]]);
  });

  it("прекращает повторы, если работу остановили снаружи", async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn().mockRejectedValue(new TransportError("лимит", 429));

    await expect(
      withRetry(operation, { sleep: noSleep, signal: controller.signal }),
    ).rejects.toThrow("лимит");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("TransportError", () => {
  it("различает временные и постоянные сбои", () => {
    expect(new TransportError("x").retryable).toBe(true); // сети нет
    expect(new TransportError("x", 429).retryable).toBe(true);
    expect(new TransportError("x", 500).retryable).toBe(true);
    expect(new TransportError("x", 502).retryable).toBe(true);
    expect(new TransportError("x", 404).retryable).toBe(false);
    expect(new TransportError("x", 403).retryable).toBe(false);
    expect(new TransportError("x", 200).retryable).toBe(false);
  });
});
