import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { sanitizePostHtml } from "../../ui/sanitize.js";
import type { Post } from "../model.js";
import type { Channel } from "../storage/types.js";
import { buildEpub, escapeXml, guessLanguage, postHtmlToXhtml } from "./epub.js";

const NOW = new Date("2026-08-30T12:00:00.000Z");

const channel: Channel = {
  id: "telegram-public:sys_sa",
  source: "telegram-public",
  username: "sys_sa",
  title: "Системный Аналитик",
  description: "Канал для системных аналитиков",
  firstPostId: 1,
  lastPostId: 40,
  importState: "complete",
  postCount: 5,
  addedAt: NOW.toISOString(),
};

function post(id: number, date: string, overrides: Partial<Post> = {}): Post {
  return {
    channel: "sys_sa",
    id,
    date,
    html: `<b>пост ${id}</b>`,
    text: `пост ${id}`,
    media: [],
    albumIds: [],
    isService: false,
    reactions: [],
    ...overrides,
  };
}

const POSTS: Post[] = [
  post(1, "2021-08-05T10:00:00+00:00", { isService: true, html: "Channel created" }),
  post(2, "2021-08-06T10:00:00+00:00"),
  post(3, "2021-08-20T10:00:00+00:00"),
  post(9, "2021-09-02T10:00:00+00:00"),
  post(40, "2021-11-02T10:00:00+00:00"),
];

function open(bytes: Uint8Array): Record<string, string> {
  const entries = unzipSync(bytes);
  return Object.fromEntries(
    Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]),
  );
}

function parseXml(source: string, type: DOMParserSupportedType = "application/xml"): Document {
  return new DOMParser().parseFromString(source, type);
}

describe("escapeXml", () => {
  it("экранирует то, что ломает XML", () => {
    expect(escapeXml('AT&T <b> "x" \'y\'')).toBe("AT&amp;T &lt;b&gt; &quot;x&quot; &apos;y&apos;");
  });
});

describe("guessLanguage", () => {
  it("определяет язык по названию канала", () => {
    expect(guessLanguage(channel)).toBe("ru");
    expect(guessLanguage({ ...channel, title: "TechSparks", description: "news" })).toBe("en");
  });
});

describe("postHtmlToXhtml", () => {
  it("отдаёт валидный XML", () => {
    const xml = postHtmlToXhtml("<b>жирный</b><br>перенос", sanitizePostHtml);
    const doc = parseXml(`<root xmlns="http://www.w3.org/1999/xhtml">${xml}</root>`);
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(xml).toContain("<b>жирный</b>");
    expect(xml).toMatch(/<br\s*\/>/);
  });

  it("заменяет собственные теги Telegram на span", () => {
    const xml = postHtmlToXhtml("<tg-spoiler>секрет</tg-spoiler>", sanitizePostHtml);
    expect(xml).not.toContain("<tg-spoiler");
    expect(xml).toContain('class="tg-spoiler"');
    expect(xml).toContain("секрет");
  });

  it("не тащит в книгу опасную разметку", () => {
    const xml = postHtmlToXhtml('текст<script>alert(1)</script>', sanitizePostHtml);
    expect(xml).not.toContain("script");
  });
});

describe("buildEpub", () => {
  const result = buildEpub(channel, POSTS, sanitizePostHtml, { now: NOW });
  const files = open(result.bytes);

  it("сообщает, что попало в книгу", () => {
    expect(result.filename).toBe("readoza-sys_sa.epub");
    expect(result.posts).toBe(4); // служебное сообщение не в счёт
    expect(result.chapters).toBe(3); // август, сентябрь, ноябрь 2021
  });

  it("кладёт mimetype первым и без сжатия", () => {
    // Требование спецификации: читалки опознают файл по этим байтам.
    const head = result.bytes.subarray(30, 38);
    expect(strFromU8(head)).toBe("mimetype");
    expect(result.bytes[8]).toBe(0); // метод сжатия: без сжатия
    expect(files["mimetype"]).toBe("application/epub+zip");
  });

  it("содержит обязательные части EPUB 3", () => {
    for (const name of [
      "META-INF/container.xml",
      "OEBPS/content.opf",
      "OEBPS/nav.xhtml",
      "OEBPS/style.css",
      "OEBPS/ch1.xhtml",
    ]) {
      expect(Object.keys(files), name).toContain(name);
    }
  });

  it("container.xml указывает на манифест", () => {
    const doc = parseXml(files["META-INF/container.xml"] ?? "");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("rootfile")?.getAttribute("full-path")).toBe("OEBPS/content.opf");
  });

  it("манифест валиден и описывает все главы", () => {
    const doc = parseXml(files["OEBPS/content.opf"] ?? "");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.getElementsByTagName("dc:title")[0]?.textContent).toBe("Системный Аналитик");
    expect(doc.getElementsByTagName("dc:language")[0]?.textContent).toBe("ru");
    expect(doc.getElementsByTagName("dc:creator")[0]?.textContent).toBe("@sys_sa");

    const items = [...doc.querySelectorAll("manifest > item")].map((el) => el.getAttribute("href"));
    expect(items).toContain("nav.xhtml");
    expect(items).toContain("ch1.xhtml");
    expect(items).toContain("ch3.xhtml");

    // Каждая глава в манифесте обязана быть и в порядке чтения.
    const spine = [...doc.querySelectorAll("spine > itemref")].map((el) => el.getAttribute("idref"));
    expect(spine).toEqual(["ch1", "ch2", "ch3"]);
  });

  it("оглавление перечисляет месяцы по порядку", () => {
    const doc = parseXml(files["OEBPS/nav.xhtml"] ?? "", "application/xhtml+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const titles = [...doc.querySelectorAll("nav ol li a")].map((el) => el.textContent);
    expect(titles).toEqual(["August 2021", "September 2021", "November 2021"]);
  });

  it("каждая глава разбирается как XHTML без ошибок", () => {
    for (const name of Object.keys(files).filter((f) => f.endsWith(".xhtml"))) {
      const doc = parseXml(files[name] ?? "", "application/xhtml+xml");
      expect(doc.querySelector("parsererror"), `${name} не валиден`).toBeNull();
    }
  });

  it("складывает посты по месяцам и не тащит служебные сообщения", () => {
    const august = files["OEBPS/ch1.xhtml"] ?? "";
    expect(august).toContain("пост 2");
    expect(august).toContain("пост 3");
    expect(august).not.toContain("Channel created");
    expect(files["OEBPS/ch2.xhtml"] ?? "").toContain("пост 9");
  });

  it("ведёт из книги обратно в Telegram", () => {
    expect(files["OEBPS/ch1.xhtml"] ?? "").toContain("https://t.me/sys_sa/2");
  });

  it("выносит медиа ссылкой, а не молча теряет его", () => {
    const withMedia = buildEpub(
      channel,
      [post(5, "2021-08-07T10:00:00+00:00", {
        media: [{ kind: "photo", thumb: "https://cdn4.telesco.pe/x.jpg", postUrl: "https://t.me/sys_sa/5" }],
      })],
      sanitizePostHtml,
      { now: NOW },
    );
    expect(open(withMedia.bytes)["OEBPS/ch1.xhtml"]).toContain("photo in Telegram");
  });

  it("переживает канал без единого пригодного поста", () => {
    const empty = buildEpub(channel, [POSTS[0] as Post], sanitizePostHtml, { now: NOW });
    expect(empty.posts).toBe(0);
    expect(empty.chapters).toBe(0);
    const doc = parseXml(open(empty.bytes)["OEBPS/content.opf"] ?? "");
    expect(doc.querySelector("parsererror")).toBeNull();
  });

  // Кладёт готовую книгу на диск, чтобы открыть её настоящей читалкой:
  //   READOZA_EPUB_OUT=/tmp/sample.epub npm test
  it.runIf(process.env["READOZA_EPUB_OUT"])("сохраняет образец книги на диск", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env["READOZA_EPUB_OUT"] as string, result.bytes);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  it("не ломается на названии канала с амперсандом", () => {
    const tricky = buildEpub(
      { ...channel, title: 'AT&T <script>' },
      [post(2, "2021-08-06T10:00:00+00:00")],
      sanitizePostHtml,
      { now: NOW },
    );
    const doc = parseXml(open(tricky.bytes)["OEBPS/content.opf"] ?? "");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.getElementsByTagName("dc:title")[0]?.textContent).toBe("AT&T <script>");
  });
});
