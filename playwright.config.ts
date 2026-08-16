import { defineConfig } from '@playwright/test'
import { Config, Effect } from 'effect'

const isCI = Effect.runSync(
  Config.boolean('CI').pipe(Config.withDefault(false)),
)

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:7782',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run --cwd packages/app preview --port 7782',
    url: 'http://127.0.0.1:7782',
    reuseExistingServer: !isCI,
  },
})
