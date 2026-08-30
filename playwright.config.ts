import { defineConfig } from "@playwright/test";

/**
 * Браузерные тесты. Проверяют то, чего не видит jsdom: настоящую прокрутку,
 * IntersectionObserver, восстановление позиции после перезагрузки страницы.
 *
 * Сети не требуют: запросы к Telegram перехватываются внутри браузера и
 * обслуживаются сохранёнными фикстурами, то есть настоящим HTML Telegram.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    browserName: "chromium",
    // Полный Chromium вместо headless-shell: shell это отдельная загрузка,
    // а нам всё равно нужен настоящий рендеринг для прокрутки и observer-ов.
    channel: "chromium",
    viewport: { width: 1000, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
