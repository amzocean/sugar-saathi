import { defineConfig } from "@playwright/test";
import { scryptSync } from "node:crypto";
import path from "node:path";

const salt = "0123456789abcdef0123456789abcdef";
const hash = scryptSync("synthetic-browser-only-passphrase", salt, 64).toString("hex");
export default defineConfig({
  testDir: "./tests", testMatch: "ui.spec.ts", workers: 1,
  globalSetup: "./tools/browser-fixture.ts",
  globalTeardown: "./tools/browser-fixture.ts",
  use: {
    baseURL: "http://127.0.0.1:3127",
    channel: process.platform === "win32" ? "msedge" : undefined,
    viewport: { width: 390, height: 844 }, timezoneId: "Asia/Kolkata",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 3127 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3127", reuseExistingServer: false, timeout: 120_000,
    env: {
      FAMILY_PASSWORD_HASH: `scrypt:${salt}:${hash}`,
      SESSION_SECRET: "synthetic-browser-test-signing-secret-never-for-real-use",
      DATA_STORAGE: "local",
      SAATHI_LOCAL_DIRECTORY: path.join(process.cwd(), "tests", ".browser-data"),
      VOICE_PROTOTYPE_ENABLED: "false",
    },
  },
});
