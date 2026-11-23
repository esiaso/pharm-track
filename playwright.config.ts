import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the web app. They start the SupplyTrack/CliniTrack stubs,
 * the API (built, dev-header sign-in) and the web app (built), and RESET the
 * database in E2E_DATABASE_URL first. Never point it at a database you care about.
 *
 *   npm run build -w apps/api && npm run build -w apps/web
 *   E2E_DATABASE_URL=postgresql://… npx playwright test
 */
const db = process.env.E2E_DATABASE_URL;
if (!db) throw new Error('Set E2E_DATABASE_URL to a throwaway database: the browser tests reset it.');

const apiEnv = {
  DATABASE_URL: db,
  AUTH_MODE: 'dev-headers',
  JOBS_ENABLED: 'false',
  PORT: '3000',
  CLINITRACK_BASE_URL: 'http://localhost:4000/api/v1',
  SUPPLYTRACK_BASE_URL: 'http://localhost:5000/api/v1',
  SMS_PROVIDER: 'log',
  NODE_ENV: 'development',
};

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } }, testIgnore: /phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone/ },
  ],
  webServer: [
    { command: 'npm run stubs -w apps/api', port: 5000, reuseExistingServer: false, timeout: 60_000 },
    { command: 'node apps/api/dist/main.js', url: 'http://localhost:3000/health/ready', env: apiEnv, reuseExistingServer: false, timeout: 60_000 },
    { command: 'npm run start -w apps/web', url: 'http://localhost:3001', reuseExistingServer: false, timeout: 60_000 },
  ],
});
