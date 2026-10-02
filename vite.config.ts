import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const TELEGRAM = "https://t.me";

// Браузер не может ходить в t.me напрямую: CORS-заголовков там нет.
// В разработке это решает прокси самого Vite, никакого отдельного сервиса не нужно.
// Для сборки под web понадобится такой же тонкий stateless-прокси в проде.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const base = env.VITE_BASE_PATH ?? "/";
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) {
    throw new Error("VITE_BASE_PATH must be an absolute path ending in /, such as /readoza/");
  }
  if (command === "build" && base !== "/") {
    let proxy: URL;
    try {
      proxy = new URL(env.VITE_TG_PROXY ?? "");
    } catch {
      throw new Error("Pages requires VITE_TG_PROXY=https://<worker>.workers.dev/tg");
    }
    if (proxy.protocol !== "https:" || proxy.username || proxy.password || proxy.search || proxy.hash || !proxy.pathname.endsWith("/tg")) {
      throw new Error("VITE_TG_PROXY must be an HTTPS proxy URL ending in /tg");
    }
  }
  return {
    base,
    plugins: [
      react(),
      // Оболочка приложения кэшируется, поэтому Readoza открывается без сети:
      // все посты и позиция чтения и так лежат локально, было бы странно
      // показывать ошибку браузера поверх уже скачанного канала.
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg"],
        manifest: {
          name: "Readoza",
          short_name: "Readoza",
          description: "Read a Telegram channel like a book. Start at post one.",
          theme_color: "#1c1b19",
          background_color: "#fdfcfa",
          display: "standalone",
          start_url: base,
          scope: base,
          icons: [
            { src: "icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
          // Ответы Telegram кэшировать нельзя: страницы по 200 KB и меняются.
          navigateFallbackDenylist: [/^\/tg/, /^\/readoza\/tg/],
        },
      }),
    ],
    server: {
      // Слушаем все интерфейсы, иначе с телефона в той же сети не открыть.
      host: true,
      port: 5173,
      strictPort: true,
      // Обращение по mDNS-имени вида macbook.local Vite иначе отклоняет.
      allowedHosts: [".local"],
      proxy: {
        "/tg": {
          target: TELEGRAM,
          changeOrigin: true,
          headers: { "User-Agent": UA, "Accept-Language": "en" },
          rewrite: (path) => path.replace(/^\/tg/, ""),
        },
      },
    },
    // Тот же доступ для проверки собранной версии, включая service worker.
    preview: {
      host: true,
      port: 4173,
      allowedHosts: [".local"],
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
