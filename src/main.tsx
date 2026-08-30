import { createRoot } from "react-dom/client";
import { createTelegramPublicSource } from "./core/source/telegram/source.js";
import { createIdbRepo } from "./core/storage/idb.js";
import { createWebTransport } from "./platform/web/transport.js";
import { App } from "./ui/App.js";
import "./ui/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("не найден #root");
const root = createRoot(container);

void (async () => {
  // Просим браузер не вытеснять хранилище: на iOS IndexedDB могут вычистить
  // при нехватке места, а вместе с ним уедет и позиция чтения.
  await navigator.storage?.persist?.().catch(() => false);

  const repo = await createIdbRepo();
  const source = createTelegramPublicSource(createWebTransport());

  // StrictMode намеренно не включён: двойной вызов эффектов в разработке
  // означал бы двойные запросы к Telegram на каждой подгрузке.
  root.render(<App repo={repo} source={source} />);
})();
