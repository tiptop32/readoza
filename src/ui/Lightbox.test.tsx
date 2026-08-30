import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Media, Post } from "../core/model.js";
import { Lightbox } from "./Lightbox.js";
import { PostView } from "./PostView.js";

const photo = (n: number): Media => ({
  kind: "photo",
  thumb: `https://cdn4.telesco.pe/${n}.jpg`,
  postUrl: `https://t.me/sys_sa/${n}`,
});

/**
 * Картинки намеренно с alt="", поэтому по роли img они не ищутся: имя несёт
 * кнопка «Open photo», а у оверлея своё aria-label. Ищем их по разметке.
 */
const images = (selector: string): HTMLImageElement[] => [
  ...document.querySelectorAll<HTMLImageElement>(selector),
];

function renderLightbox(photos: Media[], index = 0) {
  const onClose = vi.fn();
  const onIndex = vi.fn();
  render(<Lightbox photos={photos} index={index} onIndex={onIndex} onClose={onClose} />);
  return { onClose, onIndex };
}

describe("Lightbox", () => {
  it("показывает выбранную картинку", () => {
    renderLightbox([photo(1), photo(2)], 1);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Photo 2 of 2");
    expect(images(".lightbox__image")[0]?.getAttribute("src")).toBe(
      "https://cdn4.telesco.pe/2.jpg",
    );
    expect(screen.getByText("2 / 2")).toBeDefined();
  });

  it("закрывается по Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderLightbox([photo(1)]);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("листает альбом стрелками по кругу", async () => {
    const user = userEvent.setup();
    const { onIndex } = renderLightbox([photo(1), photo(2), photo(3)], 2);
    await user.keyboard("{ArrowRight}");
    expect(onIndex).toHaveBeenCalledWith(0); // с последней на первую
    await user.keyboard("{ArrowLeft}");
    expect(onIndex).toHaveBeenCalledWith(1);
  });

  it("не листает, когда картинка одна", async () => {
    const user = userEvent.setup();
    const { onIndex } = renderLightbox([photo(1)]);
    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(onIndex).not.toHaveBeenCalled();
  });

  it("закрывается по клику мимо картинки, но не по самой картинке", async () => {
    const user = userEvent.setup();
    const { onClose } = renderLightbox([photo(1)]);

    await user.click(images(".lightbox__image")[0]!);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("ведёт к оригиналу в Telegram", () => {
    renderLightbox([photo(7)]);
    const link = screen.getByRole("link", { name: "Open in Telegram" });
    expect(link.getAttribute("href")).toBe("https://t.me/sys_sa/7");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("возвращает прокрутку страницы после закрытия", () => {
    const { unmount } = render(
      <Lightbox photos={[photo(1)]} index={0} onIndex={vi.fn()} onClose={vi.fn()} />,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("PostView: открытие картинок", () => {
  const post: Post = {
    channel: "sys_sa",
    id: 42,
    date: "2021-08-14T12:00:00+00:00",
    html: "<b>пост</b>",
    text: "пост",
    // Видео идёт первым намеренно: индекс должен считаться по фотографиям.
    media: [
      { kind: "video", url: "https://cdn4.telesco.pe/v.mp4" },
      photo(1),
      photo(2),
    ],
    albumIds: [42, 43],
    isService: false,
    reactions: [],
  };

  it("нумерует фотографии отдельно от прочего медиа", async () => {
    const user = userEvent.setup();
    const onOpenImage = vi.fn();
    render(<PostView post={post} read={false} onOpenImage={onOpenImage} />);

    const buttons = screen.getAllByRole("button", { name: "Open photo" });
    expect(buttons).toHaveLength(2); // видео кнопкой не становится

    await user.click(buttons[1]!);
    expect(onOpenImage).toHaveBeenCalledWith(1);
  });

  it("без обработчика картинки остаются обычными", () => {
    render(<PostView post={post} read={false} />);
    expect(screen.queryByRole("button", { name: "Open photo" })).toBeNull();
    expect(images(".post__photo")).toHaveLength(2);
  });
});
