// Serve only the built artifact. No Vite transforms, dev proxy or source fallback.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

const root = resolve("dist");
const base = "/readoza/";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (!pathname.startsWith(base)) { response.writeHead(404).end(); return; }
  const file = resolve(root, pathname.slice(base.length) || "index.html");
  if (!file.startsWith(root + sep)) { response.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch { response.writeHead(404).end(); }
}).listen(4175, "127.0.0.1");
