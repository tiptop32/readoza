import { useCallback, useEffect, useRef } from "react";
import type { ReactElement } from "react";
import type { Media } from "../core/model.js";

/**
 * Просмотр фото во весь экран.
 *
 * В ленте картинки помещаются в колонку шириной с текст, а у альбома делятся ещё
 * и надвое, так что разглядеть на них что-либо невозможно. Telegram отдаёт превью
 * заметно большего размера, чем мы показываем, поэтому увеличивать есть что.
 *
 * Рендерится на уровне читалки, а не внутри поста: у поста стоит
 * content-visibility, а это подразумевает contain, который обрезал бы
 * position: fixed по границам поста.
 */
export function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: Media[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}): ReactElement | null {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<Element | null>(null);
  const photo = photos[index];

  const move = useCallback(
    (step: number) => {
      if (photos.length < 2) return;
      onIndex((index + step + photos.length) % photos.length);
    },
    [index, photos.length, onIndex],
  );

  // Клавиатура: закрыть и листать, не трогая мышь.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") move(1);
      else if (event.key === "ArrowLeft") move(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, onClose]);

  // Фон не должен прокручиваться под открытой картинкой.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Фокус уходит в оверлей и возвращается туда, откуда пришёл.
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      (returnFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  if (!photo) return null;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={photos.length > 1 ? `Photo ${index + 1} of ${photos.length}` : "Photo"}
      onClick={onClose}
    >
      <button ref={closeRef} type="button" className="lightbox__close" aria-label="Close">
        ×
      </button>

      {photos.length > 1 ? (
        <>
          <button
            type="button"
            className="lightbox__nav lightbox__nav--prev"
            aria-label="Previous photo"
            onClick={(event) => {
              event.stopPropagation();
              move(-1);
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="lightbox__nav lightbox__nav--next"
            aria-label="Next photo"
            onClick={(event) => {
              event.stopPropagation();
              move(1);
            }}
          >
            ›
          </button>
        </>
      ) : null}

      <img
        className="lightbox__image"
        src={photo.thumb}
        alt=""
        // Клик по самой картинке не должен закрывать: по ней целятся, чтобы рассмотреть.
        onClick={(event) => event.stopPropagation()}
      />

      <div className="lightbox__footer" onClick={(event) => event.stopPropagation()}>
        {photos.length > 1 ? (
          <span className="lightbox__counter">
            {index + 1} / {photos.length}
          </span>
        ) : null}
        {photo.postUrl ? (
          <a href={photo.postUrl} target="_blank" rel="noopener noreferrer">
            Open in Telegram
          </a>
        ) : null}
      </div>
    </div>
  );
}
