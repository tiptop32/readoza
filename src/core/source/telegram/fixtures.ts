import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Загрузчик golden-фикстур для тестов парсера.
 *
 * Путь считается от корня проекта, а не от import.meta.url: под окружением jsdom
 * import.meta.url не является file:-адресом, и readFileSync его не принимает.
 */
const DIR = resolve(process.cwd(), "src/core/source/telegram/__fixtures__");

export const fixture = (name: string): string => readFileSync(resolve(DIR, name), "utf8");
