import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;
const DIR = ".wrangler/e2e";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Permite usar un Chromium ya instalado (CHROMIUM_PATH) en lugar de descargar uno.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"] } },
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
  workers: 1,
  webServer: {
    command:
      `rm -rf ${DIR} && npx wrangler d1 migrations apply elite --local --persist-to ${DIR} && ` +
      `npx wrangler dev --port ${PORT} --persist-to ${DIR} ` +
      `--var EDITOR_PASSWORD:clave-editor --var VIEWER_PASSWORD:clave-del-jefe ` +
      `--var SESSION_SECRET:secreto-e2e-con-mas-de-32-caracteres-xx`,
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
