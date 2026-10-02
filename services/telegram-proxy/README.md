# Telegram proxy

Stateless Cloudflare Worker. Run these commands from this directory:

```bash
npm ci
npm test
npm run eval
npm run build
```

Gate tests use Node's standard library and need no installed dependencies. `build`
bundles the Worker with the pinned Wrangler version using `deploy --dry-run`; it
does not publish. The independent eval replays the repository's saved Telegram HTML
corpus and requires byte-identical responses for every fixture (100% pass threshold).
It does not run the reader's test suite.

## HTTP contract

- `GET /tg/<channel>` returns a public channel card.
- `GET /tg/s/<channel>` returns the public feed.
- A single positive numeric `before` or `after` parameter is allowed.
- `OPTIONS` supports GET preflight. Other methods return 405.
- The upstream is always `https://t.me`; requests cannot select another host.
- Up to three redirects are allowed, only to validated public channel paths on the
  same HTTPS origin without credentials, fragments or arbitrary query parameters.
- `READOZA_ALLOWED_ORIGIN` configures the permitted browser origin. Default:
  `https://tiptop32.github.io`. No cookies or credentials are forwarded. Requests
  without Origin remain available to command-line clients; CORS is not authentication.
- Upstream HTTP errors keep their status and `Retry-After`, including CORS headers.
  Network failures return 502, timeouts return 504, invalid requests return 400.
- Only HTML is returned. Bodies over 1,500,000 bytes fail with 502. The 12-second
  deadline includes redirects and body reads. Responses use `Cache-Control: no-store`.

No database, reading history, analytics or application request logging is enabled.
Cloudflare still processes requests as the hosting provider.

## Publication

After approval, `npm run login` opens Cloudflare OAuth and `npm run deploy` publishes
the Worker on `workers.dev`. Before the first Actions deployment, open Cloudflare
Workers & Pages once to create the account's `workers.dev` subdomain. An interactive
local `npm run deploy` can register it instead. Successful API-token verification does
not prove that this subdomain onboarding is complete. Append `/tg` to the printed URL and set it as the Pages
repository variable `VITE_TG_PROXY`. For local UI development, Vite's own `/tg` proxy
is sufficient. `npm run dev` starts a local Worker; to call it from a browser on a
different origin, configure that origin explicitly rather than using `*`.

Live verification, after publication, from this directory:

```bash
TG_PROXY_URL=https://YOUR-WORKER.workers.dev/tg npm run eval:live
```

Replace `YOUR-WORKER` with the printed hostname. This command performs two real
Telegram requests, verifies HTML markers and CORS, and fails on network, rate-limit
or markup changes. It is separate from the offline gate and is not run without a
deployed endpoint. Free Workers currently allow 100,000 requests/day. No paid
features are configured; a large channel may take many paginated requests.
