import { useMemo } from "react";
import type { ReactElement } from "react";
import type { Media, Post } from "../core/model.js";
import { formatDay } from "./format.js";
import { sanitizePostHtml } from "./sanitize.js";

function MediaView({ media, onOpen }: { media: Media; onOpen?: () => void }): ReactElement | null {
  if (media.kind === "photo") {
    if (!media.thumb) return null;
    // width и height занимают место под картинку до загрузки: без них дозагрузка
    // сдвигает уже прочитанный текст и утаскивает восстановленную позицию.
    const image = (
      <img
        className="post__photo"
        src={media.thumb}
        alt=""
        loading="lazy"
        width={media.width}
        height={media.height}
      />
    );
    // В колонке шириной с текст, а в альбоме ещё и вдвое уже, разглядеть
    // что-либо невозможно, поэтому фото открывается во весь экран.
    return onOpen ? (
      <button type="button" className="post__photo-button" onClick={onOpen} aria-label="Open photo">
        {image}
      </button>
    ) : (
      image
    );
  }
  if (media.kind === "video") {
    return (
      <video
        className="post__video"
        src={media.url}
        poster={media.thumb}
        controls
        preload="none"
        playsInline
        width={media.width}
        height={media.height}
      />
    );
  }
  return (
    <a className="post__document" href={media.postUrl} target="_blank" rel="noopener noreferrer">
      <span className="post__document-title">{media.title ?? "file"}</span>
      {media.size ? <span className="post__document-size">{media.size}</span> : null}
    </a>
  );
}

export function PostView({
  post,
  read,
  onOpenImage,
}: {
  post: Post;
  read: boolean;
  /** Индекс среди фотографий поста, а не среди всего медиа. */
  onOpenImage?: (photoIndex: number) => void;
}): ReactElement {
  // Разметка приходит с чужого сайта, рендерить её без санитизации нельзя.
  const html = useMemo(() => sanitizePostHtml(post.html), [post.html]);
  const album = post.albumIds.length > 1;

  // Видео и документы в счёт не идут: листается только альбом из фотографий.
  const photoIndexes = useMemo(() => {
    let seen = -1;
    return post.media.map((media) => (media.kind === "photo" ? (seen += 1) : -1));
  }, [post.media]);

  return (
    <article
      className={`post${post.isService ? " post--service" : ""}${read ? " post--read" : ""}`}
      id={`post-${post.id}`}
      data-post-id={post.id}
    >
      <header className="post__meta">
        <time dateTime={post.date}>{formatDay(post.date)}</time>
        {post.forwardedFrom ? (
          <span className="post__forwarded">
            forwarded from{" "}
            <a href={post.forwardedFrom.url} target="_blank" rel="noopener noreferrer">
              {post.forwardedFrom.name}
            </a>
          </span>
        ) : null}
      </header>

      {post.media.length > 0 ? (
        <div className={`post__media${album ? " post__media--album" : ""}`}>
          {post.media.map((media, index) => {
            const photoIndex = photoIndexes[index] ?? -1;
            const open =
              onOpenImage && photoIndex >= 0 ? () => onOpenImage(photoIndex) : undefined;
            return (
              <MediaView
                key={`${media.kind}-${media.url ?? media.thumb ?? index}`}
                media={media}
                {...(open ? { onOpen: open } : {})}
              />
            );
          })}
        </div>
      ) : null}

      {html ? (
        // eslint-disable-next-line react/no-danger -- прошло через sanitizePostHtml
        <div className="post__text" dangerouslySetInnerHTML={{ __html: html }} />
      ) : null}

      {post.linkPreview ? (
        <a
          className="post__link-preview"
          href={post.linkPreview.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {post.linkPreview.image ? (
            <img src={post.linkPreview.image} alt="" loading="lazy" />
          ) : null}
          <span className="post__link-preview-body">
            {post.linkPreview.siteName ? <b>{post.linkPreview.siteName}</b> : null}
            {post.linkPreview.title ? <strong>{post.linkPreview.title}</strong> : null}
            {post.linkPreview.description ? <span>{post.linkPreview.description}</span> : null}
          </span>
        </a>
      ) : null}
    </article>
  );
}
