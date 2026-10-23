const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: [
    [isCI ? 'github' : 'list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    // Serve the app locally; bound to loopback so it is never exposed on the network.
    command: `npx http-server . -p ${PORT} -a 127.0.0.1 -c-1 --silent`,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 30_000
  }
});
