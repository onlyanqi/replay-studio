import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://localhost:3001', headless: true },
  reporter: 'list',
});
