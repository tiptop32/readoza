import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./evals",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"], ["json", { outputFile: process.env.READOZA_EVIDENCE_DIR
    ? `${process.env.READOZA_EVIDENCE_DIR}/pages-eval.json` : "/tmp/readoza-pages/pages-eval.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4175/readoza/",
    browserName: "chromium",
    channel: "chromium",
    viewport: { width: 1000, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-dist.mjs",
    url: "http://127.0.0.1:4175/readoza/",
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
