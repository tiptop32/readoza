# Readoza sync

Cloudflare Worker + D1 service for nickname and 128-bit code synchronization. The code is salted and hashed; plaintext codes are never stored. `POST /v1/sync/login` creates an account only with `create: true`; otherwise it authenticates an existing nickname. `POST /v1/sync/save` performs a compare-and-swap update and returns `409` with the current snapshot on a stale revision.

Create a D1 database, put its ID in `wrangler.toml`, apply `wrangler d1 migrations apply readoza-sync --remote`, then deploy with `wrangler deploy`.

The browser stores a separate IndexedDB database per nickname. Its recovery code is
kept in that browser's localStorage and must be copied to each new device. D1 stores
only a salted hash of the code plus channel metadata and reading positions. Telegram
post bodies stay on each device. The snapshot limit is 64 KiB.

To publish, create a free D1 database named `readoza-sync`, save its UUID as the
GitHub Actions variable `READOZA_D1_DATABASE_ID`, and give the Cloudflare token
D1 Edit and Workers Scripts Edit for this account. Run the manual **Reader sync**
workflow. It applies migrations before deploying the Worker. Save the resulting
HTTPS Worker origin (no path) in the Actions variable `VITE_SYNC_URL`, then run
the manual **Pages** workflow. `npm --prefix services/sync test`, `eval`, and
`build` can run locally without Cloudflare credentials.
