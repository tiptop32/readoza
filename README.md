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

## Export the channel as a book

A channel can be exported to EPUB and read in Kindle, Apple Books or anything else. This is the
"like a book" promise taken literally, and it is also the only part of Readoza that outlives the
source: the file works offline forever and would survive `t.me/s` disappearing entirely.

The book covers the whole channel, not the part that happens to have been read. Reading pulls
pages lazily, only as far as you got, so exporting an unfinished channel downloads the rest
first and says so while it does. If Telegram cuts the feed short before the end, the file is
still produced, with a plain statement that it is incomplete.

Chapters are split by month, because fifteen hundred posts in one flow is not a book. Every post
links back to the original message in Telegram. Service messages are left out. Media is not
embedded, only linked: Readoza stores post text locally but never the image and video bytes, and
downloading them at export time would mean thousands of extra requests.

## Offline and flaky networks

Readoza is installable and its shell is cached by a service worker, so it opens with no
connection at all. Everything already downloaded stays readable, and the reader says so instead
of pretending the channel ended. Adding a new channel is the only thing that needs a network.

Telegram promises nothing about `t.me/s`: no documented rate limits, no stability. A single 429
or a dropped connection must not kill a crawl that has been running for minutes and already made
progress, so requests are retried with a widening pause (1s, 2s, 4s). Only failures worth
retrying are retried: a network error, a 429 or a 5xx. A 404 fails immediately, because
repeating it would just be noise.

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
    reader/retry.ts           widening backoff for the failures worth retrying
    export/epub.ts            the channel as an EPUB 3 book
  platform/
    http.ts                   fetch HTML, or fail with an error that says whether
                              retrying is worth it
    web/transport.ts          browser: through a proxy, because of CORS
  ui/                         React reader: omnibox, channel list, continuous scroll
```

## Development

```bash
npm install
npm test          # offline, deterministic, ~2.5 s
npm run typecheck
```

## GitHub Pages

The public site can run at `https://tiptop32.github.io/readoza/`. Pages serves the
static app; a Cloudflare Worker fetches Telegram HTML because `t.me` does not allow
cross-origin browser requests. Posts and reading position stay in IndexedDB on each
device. Switching from localhost to Pages creates a separate browser library.

Both publications are **manual**. Main pushes and pull requests validate the app;
only `workflow_dispatch` publishes. No custom domain or paid server is required.

After reviewing and approving the first publication:

1. Create a free Cloudflare account. Install the proxy dependencies and log in locally:

   ```bash
   npm ci --prefix services/telegram-proxy
   npm --prefix services/telegram-proxy run login
   ```

2. Deploy the Worker and save the HTTPS `workers.dev` URL printed by Wrangler:

   ```bash
   npm --prefix services/telegram-proxy run deploy
   ```

   The browser proxy address is that URL with `/tg` appended. The Worker allows the
   origin `https://tiptop32.github.io`. For a custom domain, change
   `READOZA_ALLOWED_ORIGIN` in `services/telegram-proxy/wrangler.toml` before deployment.

3. In repository **Settings → Secrets and variables → Actions → Variables**, add
   `VITE_TG_PROXY` with the full HTTPS address ending in `/tg`. This address is public;
   it is embedded in the static JavaScript. No Cloudflare credential goes into Vite variables.

4. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. In
   **Actions → Pages → Run workflow**, select `main` and run the workflow. Publication
   is blocked if the proxy variable is missing or invalid. Tests and the browser eval
   run against the exact build before it is uploaded.

For later Worker publications through Actions, create a Cloudflare API token scoped
to this account with **Account → Workers Scripts → Edit**. Save it as the GitHub secret
`CLOUDFLARE_API_TOKEN`, and save the account ID as `CLOUDFLARE_ACCOUNT_ID`. Run the
manual **Telegram proxy** workflow. Local OAuth login is enough for the first deployment;
these secrets are only required for the Actions deployment. Environment approvals can
be configured for `github-pages` and `cloudflare` in repository Settings.

Local Pages verification uses a fixture endpoint, so it needs no Cloudflare account:

```bash
npm ci
npm test
npm run test:proxy
npm run eval:proxy
npx playwright install chromium
VITE_BASE_PATH=/readoza/ VITE_TG_PROXY=https://proxy.example/tg npm run build
VITE_TG_PROXY=https://proxy.example/tg npm run eval:dist
```

`proxy.example` is intercepted by the browser eval and answered by the real Worker
handler using saved Telegram HTML. It is not a live proxy. Use the actual Worker URL
when publishing. `VITE_BASE_PATH` defaults to `/`, so the existing development and
root deployment paths keep working. The Pages eval serves only `dist` under
`/readoza/` and checks channel import, saved reading position, manifest assets, service
worker scope and an offline reload. Its pass threshold is 100%; JSON results and
screenshots go to `/tmp/readoza-pages/` locally and the `pages-verification` artifact in CI.

Cloudflare Workers Free currently allows 100,000 requests/day; one channel import can
use many requests. The Worker holds no database, rejects arbitrary hosts and paths,
buffers at most 1.5 MB of HTML, and applies a 12-second deadline to the complete upstream
request. Safe channel alias redirects stay on `https://t.me`; errors preserve their
status and CORS headers. CORS is a browser restriction, not authentication or an abuse
quota. Telegram's HTML remains an undocumented dependency. See the
[Worker README](services/telegram-proxy/README.md) and the
[publication checklist](docs/deployment.md) for live verification and failure handling.

Browser tests. These cover what jsdom cannot: real scrolling, `IntersectionObserver`, and
whether reading position survives a page reload. They need no network either, because Telegram
requests are intercepted inside the browser and answered from the same saved fixtures, so the
real parser runs against real Telegram markup:

```bash
npx playwright install chromium   # once
npm run e2e
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

## Contributors

- [tiptop32](https://github.com/tiptop32) — author and maintainer
- Claude (Anthropic), working through Claude Code — design, implementation and tests

## License

AGPL-3.0-only.
