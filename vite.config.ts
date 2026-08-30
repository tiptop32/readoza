import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const TELEGRAM = "https://t.me";

// Браузер не может ходить в t.me напрямую: CORS-заголовков там нет.
// В разработке это решает прокси самого Vite, никакого отдельного сервиса не нужно.
// Для сборки под web понадобится такой же тонкий stateless-прокси в проде.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/tg": {
        target: TELEGRAM,
        changeOrigin: true,
        headers: { "User-Agent": UA, "Accept-Language": "en" },
        rewrite: (path) => path.replace(/^\/tg/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
