import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PUNCHPAY_E2E_PORT || 3105);

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: process.env.PUNCHPAY_E2E_OUT || "test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: "chrome",
    trace: "off",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        channel: "chrome",
      },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
      PUNCHPAY_DB_PATH: ".data/punchpay-e2e.db",
    },
  },
});
