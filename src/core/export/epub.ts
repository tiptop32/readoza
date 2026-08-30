import { strToU8, zipSync } from "fflate";
import type { Post } from "../model.js";
import type { Channel } from "../storage/types.js";

/**
 * Экспорт канала в EPUB.
 *
 * Обещание продукта «канал как книга» здесь становится буквальным: файл читается
 * в Kindle, Apple Books или чём угодно ещё, работает офлайн навсегда и переживёт
 * даже смерть t.me/s, на котором держится всё остальное приложение.
 *
 * Формат: EPUB 3. Это ZIP, в котором первым и обязательно несжатым лежит mimetype,
 * дальше META-INF/container.xml и OEBPS с манифестом, оглавлением и главами.
 * Главы бьются по месяцам: полторы тысячи постов одним полотном нечитаемы.
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const OPS_NS = "http://www.idpf.org/2007/ops";

export interface EpubOptions {
  /** Момент сборки. Вынесен наружу, чтобы тесты были детерминированными. */
  now?: Date;
  /** Язык книги. По умолчанию определяется по названию канала. */
  language?: string;
}

export interface EpubResult {
  bytes: Uint8Array;
  filename: string;
  /** Сколько постов реально попало в книгу: служебные сообщения отбрасываются. */
  posts: number;
  chapters: number;
}

/** XML-экранирование для текстовых узлов и атрибутов. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Язык книги. EPUB требует dc:language, а Telegram его не сообщает,
 * поэтому смотрим на то, что есть: кириллица в названии и описании.
 */
export function guessLanguage(channel: Channel): string {
  return /[А-Яа-яЁё]/.test(`${channel.title} ${channel.description ?? ""}`) ? "ru" : "en";
}

/** Ключ и человекочитаемое название главы: месяц публикации. */
function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

const MONTH_TITLE = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

function monthTitle(key: string): string {
  const date = new Date(`${key}-01T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? key : MONTH_TITLE.format(date);
}

const DAY_TITLE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function dayTitle(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DAY_TITLE.format(date);
}

/**
 * HTML поста в XHTML, пригодный для EPUB.
 *
 * Проверяющие программы для EPUB строги: документ обязан быть валидным XML.
 * Поэтому разметка не склеивается строками, а прогоняется через разбор и
 * сериализацию, а собственные теги Telegram превращаются в обычные span.
 */
export function postHtmlToXhtml(html: string, sanitize: (raw: string) => string): string {
  const doc = new DOMParser().parseFromString(`<div>${sanitize(html)}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  for (const node of root.querySelectorAll("tg-spoiler, tg-emoji")) {
    const span = doc.createElement("span");
    span.setAttribute("class", node.nodeName.toLowerCase());
    span.innerHTML = node.innerHTML;
    node.replaceWith(span);
  }

  const xml = new XMLSerializer().serializeToString(root);
  // Сериализатор вешает пространство имён на корень; в главе оно уже объявлено.
  return xml.replace(` xmlns="${XHTML_NS}"`, "");
}

function chapterXhtml(
  language: string,
  title: string,
  posts: Post[],
  channel: Channel,
  sanitize: (raw: string) => string,
): string {
  const body = posts
    .map((post) => {
      const link = `https://t.me/${channel.username}/${post.id}`;
      const media = post.media
        .map(
          (item) =>
            `<p class="media"><a href="${escapeXml(item.postUrl ?? link)}">${escapeXml(
              item.kind === "document" ? (item.title ?? "file") : item.kind,
            )} in Telegram</a></p>`,
        )
        .join("\n      ");
      const forwarded = post.forwardedFrom
        ? `<p class="forwarded">forwarded from ${escapeXml(post.forwardedFrom.name)}</p>`
        : "";
      const preview = post.linkPreview
        ? `<p class="preview"><a href="${escapeXml(post.linkPreview.url)}">${escapeXml(
            post.linkPreview.title ?? post.linkPreview.url,
          )}</a></p>`
        : "";

      return `    <section class="post" id="post-${post.id}" epub:type="chapter">
      <p class="date"><a href="${escapeXml(link)}">${escapeXml(dayTitle(post.date))}</a></p>
      ${forwarded}
      ${postHtmlToXhtml(post.html, sanitize)}
      ${media}
      ${preview}
    </section>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="${XHTML_NS}" xmlns:epub="${OPS_NS}" xml:lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>${escapeXml(title)}</h1>
${body}
  </body>
</html>
`;
}

function navXhtml(language: string, channel: Channel, chapters: { file: string; title: string }[]): string {
  const items = chapters
    .map((chapter) => `        <li><a href="${chapter.file}">${escapeXml(chapter.title)}</a></li>`)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="${XHTML_NS}" xmlns:epub="${OPS_NS}" xml:lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(channel.title)}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`;
}

function contentOpf(
  language: string,
  channel: Channel,
  chapters: { file: string; title: string }[],
  now: Date,
): string {
  const identifier = `urn:readoza:${channel.source}:${channel.username}:${channel.firstPostId ?? 0}-${channel.lastPostId ?? 0}`;
  const manifest = chapters
    .map(
      (chapter, index) =>
        `    <item id="ch${index + 1}" href="${chapter.file}" media-type="application/xhtml+xml"/>`,
    )
    .join("\n");
  const spine = chapters
    .map((_chapter, index) => `    <itemref idref="ch${index + 1}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(channel.title)}</dc:title>
    <dc:creator>@${escapeXml(channel.username)}</dc:creator>
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:publisher>Readoza</dc:publisher>
    <dc:source>https://t.me/${escapeXml(channel.username)}</dc:source>
    ${channel.description ? `<dc:description>${escapeXml(channel.description)}</dc:description>` : ""}
    <meta property="dcterms:modified">${now.toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const STYLE_CSS = `body { margin: 0 6%; line-height: 1.5; }
h1 { font-size: 1.4em; margin: 1.5em 0 1em; }
.post { margin: 0 0 2em; }
.date { font-size: 0.8em; color: #666; margin: 0 0 0.4em; }
.date a { color: #666; text-decoration: none; }
.forwarded, .media, .preview { font-size: 0.85em; color: #666; }
.tg-spoiler { background: #eee; }
`;

/**
 * Собирает EPUB из постов канала.
 * Служебные сообщения («канал создан», «закреплено») в книгу не попадают.
 */
export function buildEpub(
  channel: Channel,
  posts: Post[],
  sanitize: (raw: string) => string,
  options: EpubOptions = {},
): EpubResult {
  const now = options.now ?? new Date();
  const language = options.language ?? guessLanguage(channel);

  const readable = posts
    .filter((post) => !post.isService && post.date)
    .sort((a, b) => a.id - b.id);

  const byMonth = new Map<string, Post[]>();
  for (const post of readable) {
    const key = monthKey(post.date);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(post);
    else byMonth.set(key, [post]);
  }

  const chapters = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, chapterPosts], index) => ({
      file: `ch${index + 1}.xhtml`,
      title: monthTitle(key),
      posts: chapterPosts,
    }));

  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    // mimetype обязан быть первым и несжатым, иначе читалки не опознают файл.
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": [strToU8(CONTAINER_XML), { level: 6 }],
    "OEBPS/style.css": [strToU8(STYLE_CSS), { level: 6 }],
    "OEBPS/content.opf": [strToU8(contentOpf(language, channel, chapters, now)), { level: 6 }],
    "OEBPS/nav.xhtml": [strToU8(navXhtml(language, channel, chapters)), { level: 6 }],
  };

  for (const chapter of chapters) {
    files[`OEBPS/${chapter.file}`] = [
      strToU8(chapterXhtml(language, chapter.title, chapter.posts, channel, sanitize)),
      { level: 6 },
    ];
  }

  return {
    bytes: zipSync(files),
    filename: `readoza-${channel.username}.epub`,
    posts: readable.length,
    chapters: chapters.length,
  };
}
