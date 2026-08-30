import { describe, expect, it } from "vitest";
import { sanitizePostHtml } from "./sanitize.js";

/**
 * Мы рендерим HTML, пришедший с чужого сайта. Это тесты границы безопасности,
 * а не косметики: пропущенный скрипт в desktop-сборке живёт рядом с нативным API.
 */
describe("sanitizePostHtml", () => {
  it("вырезает скрипты", () => {
    const dirty = 'привет<script>alert("xss")</script>мир';
    const clean = sanitizePostHtml(dirty);
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("alert");
    expect(clean).toContain("привет");
  });

  it("вырезает обработчики событий", () => {
    const clean = sanitizePostHtml('<b onerror="steal()" onclick="steal()">текст</b>');
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onclick");
    expect(clean).toContain("текст");
  });

  it("не пропускает javascript: в ссылках", () => {
    const clean = sanitizePostHtml('<a href="javascript:alert(1)">клик</a>');
    expect(clean).not.toContain("javascript:");
  });

  it("вырезает img, который мог бы утащить запрос наружу", () => {
    const clean = sanitizePostHtml('<img src="https://evil.example/pixel.gif">');
    expect(clean).not.toContain("<img");
  });

  it("вырезает style, чтобы страница не ходила на внешние хосты", () => {
    const clean = sanitizePostHtml(
      "<i class=\"emoji\" style=\"background-image:url('//telegram.org/img/emoji/40/F09F9881.png')\"><b>😁</b></i>",
    );
    expect(clean).not.toContain("style");
    expect(clean).not.toContain("telegram.org");
    // символ эмодзи Telegram кладёт внутрь сам, он и остаётся видимым
    expect(clean).toContain("😁");
    expect(clean).toContain('class="emoji"');
  });

  it("сохраняет форматирование постов", () => {
    const clean = sanitizePostHtml(
      '<b>жирный</b> <i>курсив</i> <s>зачёркнутый</s> <code>код</code><pre>блок</pre><br><tg-spoiler>секрет</tg-spoiler>',
    );
    for (const tag of ["<b>", "<i>", "<s>", "<code>", "<pre>", "<br>", "tg-spoiler"]) {
      expect(clean).toContain(tag);
    }
  });

  it("уводит ссылки во внешнюю вкладку и закрывает доступ к window", () => {
    const clean = sanitizePostHtml('<a href="https://example.com">ссылка</a>');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain("noopener");
    expect(clean).toContain("noreferrer");
  });

  it("переживает пустой и битый ввод", () => {
    expect(sanitizePostHtml("")).toBe("");
    expect(sanitizePostHtml("<b>не закрыт")).toContain("не закрыт");
  });
});
