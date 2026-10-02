# Pages publication checklist

Acceptance reference: a static installable reader at `/readoza/`, with a fixed-host
Telegram proxy, saved progress after reload, and a working offline start. Local
development must still work at `/`. The first publication requires approval.

Use this checklist for every deployment change. It records the failures found
during the first implementation and makes their detection part of the workflow:

1. Read the Vite, PWA, browser transport and Worker boundaries before editing.
2. Keep production publication manual. Source pushes may validate automatically.
3. Install with `npm ci` in a clean environment, then run the reader tests and Worker
   gate. Declare build-time types explicitly; transitive Node types can mask a broken
   TypeScript configuration on a developer machine. Never infer success from the builder's report.
4. Replay the saved HTML corpus through the Worker and require a 100% score.
5. Build both root and `/readoza/` variants. A Pages build without an HTTPS proxy
   address must fail before producing a publication artifact.
6. Bundle the Worker with `npm run build` in its directory. It must not require
   production credentials for a dry-run.
7. Run `npm run eval:dist` with the same `VITE_TG_PROXY` used for the Pages build.
   File-existence checks do not establish that the application opens or works offline.
8. Check the JSON report and screenshots. The browser must load the built artifact,
   fetch through the Worker, restore progress, and reload while offline. Remove
   fixture routes before disconnecting and prove that an uncached fetch fails;
   network emulation and OS connectivity events are separate test inputs. If the
   environment cannot launch Chromium, record the failure and use CI; never call it green.
9. Get an independent review against the acceptance reference. Keep evidence under
   `/tmp`, and use the Actions verification artifact for remote runs.
10. Before the first Actions deployment, open Cloudflare Workers & Pages once to
    create the account's `workers.dev` subdomain, or run the interactive local
    `npm run deploy` to register it. A successful API-token check does not prove this
    onboarding step is complete. After approval, deploy the Worker, configure `VITE_TG_PROXY`, enable Pages, and
    run the manual Pages workflow. Run the Worker's live eval and repeat the reader
    smoke test at the public URL. Do not report publication before those checks pass.

First-run verification has three passes: configuration and lockfile checks;
executable builds and gate tests; a browser exercise against the publication artifact.
Actual Cloudflare OAuth, production deployment and live Telegram verification remain
unverified until account access and publication approval are available.

No local service needs restarting for publication. Existing dev sessions should be
stopped with Ctrl+C and restarted with `npm run dev` after pulling config changes.
For an updated installed PWA, close and reopen the app after its service worker updates.

Official references:

- [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Vite: Deploying a Static Site](https://vite.dev/guide/static-deploy.html#github-pages)
