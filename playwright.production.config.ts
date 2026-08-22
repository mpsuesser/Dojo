import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/production',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'https://dojo.bingo',
    trace: 'retain-on-failure',
  },
})
