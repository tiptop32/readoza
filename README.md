# Readoza

**Read Telegram channels like books.** Start from the first post, continue exactly where you left off.

Telegram drops you at the newest message. Readoza does the opposite: it finds post #1 of a
public channel, walks forward in chronological order, and remembers your position between
sessions. Local-first, no account, no server for the core loop.

> Status: **v0.1 works end to end in the browser.** Paste a channel, read from post one,
> close the tab, come back to the same place. Desktop and mobile builds, offline export and
> bookmarks are next.

```bash
npm install
npm run dev     # http://localhost:5173
```

## How it reads a channel

Public Telegram channels have a web preview at `https://t.me/s/<channel>` that works without a
Telegram account. It paginates with `?before=<id>` and `?after=<id>`, and every response carries
the cursors for the neighbouring windows. Readoza follows those cursors instead of computing
message ids itself, which is what makes deleted posts and id gaps a non-issue.

Verified behaviour this design relies on (probed against live Telegram, 2026-08-30):

| Behaviour | Result |
|---|---|
| `GET /s/<ch>?after=<id>` | ~20 posts per response, 1.2–2.4 s, 115–265 KB |
| Cursors | Telegram emits `data-before` / `data-after` on its own "load more" links |
| End of channel | no forward cursor in the response |
| Start of channel | no backward cursor in the response |
| Long posts | **not truncated** (posts up to ~6000 characters come through intact) |
| Deleted ids as cursor | fine, `?after=<deleted id>` still paginates correctly |
| `?after=0` | **trap**: silently ignored, returns the *latest* page. Use `?before=N` to find the start |
| Aliases | `t.me/s/breakingmash` serves `data-post="mash/…"`, so the canonical name comes from `data-post` |
| CORS | t.me sends no `Access-Control-Allow-Origin`, so the browser build needs a thin proxy. Media CDN does send `*` |

## Caveats you should know

`t.me/s` is not a documented or stable API. Telegram can change the markup, rate-limit, or
remove the preview at any time. The project is built so that this hurts as little as possible:
all of the fragile logic lives in a single file (`src/core/source/telegram/parse.ts`) pinned by
golden tests against real saved HTML. Everything already imported stays readable from the local
cache even if the source breaks entirely.

Private channels are not supported and are not planned for v0.1. That needs TDLib and a Telegram
login, which is a much larger project than the rest of Readoza combined.

## Architecture

```
UI  ──  reader logic  ──┬── Repository (IndexedDB)
                        └── Source ── Transport   ← the only platform-specific piece
```

Storage is IndexedDB rather than SQLite, because it behaves identically in the browser, the
Capacitor webview and the Tauri webview with no platform-specific code at all. SQLite would
buy SQL and full-text search at the price of three different drivers, and v0.1 has no search.

Reading position is a message id, never an ordinal, so a deleted post cannot shift where you
left off. The percentage is derived from the id range and is deliberately approximate; the
main indicator in the UI is the date. An exact "N of M" only appears once a channel has been
fully downloaded, because Telegram never exposes a post count.

In development the browser reaches Telegram through Vite's own proxy (`/tg` in
`vite.config.ts`), so there is no service to run alongside the app. A deployed web build needs
the same thing as a small stateless proxy: fetch HTML, return HTML, keep no reading history.

`Source` builds URLs and parses HTML. It knows nothing about networking: the `Transport`
function is injected at the composition root, so the browser build can route through a proxy
while desktop and mobile talk to `t.me` directly, with zero difference in the rest of the code.

```
src/
  core/                       no DOM chrome, no platform assumptions
    model.ts                  domain types, source-agnostic
    source/telegram/
      parse.ts                HTML -> domain. All fragility lives here
      source.ts               URL building, input resolution, start-of-channel search
      __fixtures__/           real Telegram HTML, refreshed by scripts/fetch-fixtures.sh
    storage/                  Repo contract + IndexedDB implementation
    reader/
      importer.ts             resumable crawl, one page at a time
      progress.ts             reading position and percentages
      library.ts              add a channel, resolve it, find its beginning
  platform/web/transport.ts   the proxy-aware fetch. Swapped per platform
  ui/                         React reader: omnibox, channel list, continuous scroll
```

## Development

```bash
npm install
npm test          # offline, deterministic, ~2.5 s
npm run typecheck
```

Live check against real Telegram (skipped by default, meant for a scheduled CI run so that
broken markup is noticed before users notice it):

```bash
READOZA_LIVE=1 npm test
```

When the parser tests fail, refresh the fixtures first and read the HTML diff:

```bash
npm run fixtures
git diff src/core/source/telegram/__fixtures__
```

## License

AGPL-3.0-only.
