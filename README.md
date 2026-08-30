# Readoza

**Read Telegram channels like books.** Start from the first post, continue exactly where you left off.

Telegram drops you at the newest message. Readoza does the opposite: it finds post #1 of a
public channel, walks forward in chronological order, and remembers your position between
sessions. Local-first, no account, no server for the core loop.

> Status: **v0.1 in progress.** The data layer (source + parser) is done and tested.
> Storage, reader UI and the "continue reading" screen are next.

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
UI  ──  reader logic  ──┬── Repository (local storage)
                        └── Source ── Transport   ← the only platform-specific piece
```

`Source` builds URLs and parses HTML. It knows nothing about networking: the `Transport`
function is injected at the composition root, so the browser build can route through a proxy
while desktop and mobile talk to `t.me` directly, with zero difference in the rest of the code.

```
src/core/
  model.ts                    domain types, source-agnostic
  source/
    types.ts                  Source + Transport interfaces
    telegram/
      parse.ts                HTML -> domain. All fragility lives here
      source.ts               URL building, input resolution, start-of-channel search
      parse.test.ts           golden tests over real fixtures
      source.test.ts          URL/cursor logic against a fake transport
      live.test.ts            opt-in network test (READOZA_LIVE=1)
      __fixtures__/           real Telegram HTML, refreshed by scripts/fetch-fixtures.sh
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
