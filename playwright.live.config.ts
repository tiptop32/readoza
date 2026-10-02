import { defineConfig } from "@playwright/test";

const evidenceDir = process.env.READOZA_EVIDENCE_DIR ?? "/tmp/readoza-live";

export default defineConfig({
  testDir: "./live-evals",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"], ["json", { outputFile: `${evidenceDir}/live-site.json` }]],
  use: {
    baseURL: "https://tiptop32.github.io/readoza/",
    browserName: "chromium",
    viewport: { width: 1000, height: 900 },
    trace: "retain-on-failure",
  },
});
