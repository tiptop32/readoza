import { useMemo } from "react";
import type { ReactElement } from "react";
import type { Media, Post } from "../core/model.js";
import { formatDay } from "./format.js";
import { sanitizePostHtml } from "./sanitize.js";

function MediaView({ media }: { media: Media }): ReactElement | null {
  if (media.kind === "photo") {
    return media.thumb ? <img className="post__photo" src={media.thumb} alt="" loading="lazy" /> : null;
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

export function PostView({ post, read }: { post: Post; read: boolean }): ReactElement {
  // Разметка приходит с чужого сайта, рендерить её без санитизации нельзя.
  const html = useMemo(() => sanitizePostHtml(post.html), [post.html]);
  const album = post.albumIds.length > 1;

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
          {post.media.map((media, index) => (
            <MediaView key={`${media.kind}-${media.url ?? media.thumb ?? index}`} media={media} />
          ))}
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
