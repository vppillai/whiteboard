/**
 * Playwright e2e config — chromium-only smoke suite against the
 * PRODUCTION build.
 *
 * Server choice: we run the real Bun static server (apps/server) pointed
 * at apps/web/dist instead of `vite preview`. The Bun server is what
 * production deploys run — same binary, same security headers (CSP etc.),
 * so the suite exercises the page exactly as users get it. It fits
 * Playwright's webServer lifecycle fine: plain foreground process,
 * health-checked via GET /health.
 *
 * Build first: the root `test:e2e` script runs the web build before
 * invoking Playwright. Running `playwright test` directly against a stale
 * or missing apps/web/dist is on you.
 */

import { defineConfig } from '@playwright/test'

// Dedicated port so the suite never collides with a dev server (8787).
const PORT = 8788

export default defineConfig({
  testDir: './tests',
  // *.e2e.ts (not *.spec.ts / *.test.ts): `bun test` auto-globs BOTH of
  // those suffixes, so this naming is what keeps the unit and e2e suites
  // from bleeding into each other.
  testMatch: '**/*.e2e.ts',
  // Tests share one server but get isolated browser contexts (fresh
  // IndexedDB / localStorage per test). One worker keeps pixel-assertion
  // timing deterministic; the suite is small enough that speed is fine.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // cwd defaults to this config's directory (apps/e2e); DIST_DIR is
    // resolved by the server against its cwd, hence the relative hop.
    command: 'bun ../server/src/index.ts',
    url: `http://localhost:${PORT}/health`,
    env: { PORT: String(PORT), DIST_DIR: '../web/dist' },
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
