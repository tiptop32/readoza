import DOMPurify from "dompurify";

/**
 * Санитизация HTML постов.
 *
 * Мы рендерим разметку, пришедшую с чужого сайта, поэтому это не гигиена, а
 * защита от XSS. В desktop-сборке рядом с webview лежит нативный API, так что
 * цена пропущенного скрипта там выше, чем в обычной вкладке браузера.
 *
 * style вырезается намеренно: Telegram рисует эмодзи через background-image с
 * telegram.org, а настоящий символ эмодзи и так лежит внутри <b>. Без style
 * эмодзи отображается текстом, и страница не ходит на внешние хосты.
 */

const ALLOWED_TAGS = [
  "b", "strong", "i", "em", "u", "s", "del", "a", "code", "pre",
  "br", "span", "blockquote", "tg-spoiler", "tg-emoji",
];

const ALLOWED_ATTR = ["href", "class", "dir"];

let hooked = false;

function installHooks(): void {
  if (hooked) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "A") return;
    // Ссылки из постов ведут наружу и не должны получать доступ к нашему window.
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  });
  hooked = true;
}

export function sanitizePostHtml(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
    ALLOW_DATA_ATTR: false,
  });
}
