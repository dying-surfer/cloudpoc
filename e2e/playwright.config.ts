import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke-Tests gegen einen laufenden Stack. Sie prüfen nur, ob die Teile zusammenspielen
 * (Proxy, Frontend, Backend, DB); die Fachlogik testen PHPUnit und Vitest.
 *
 * BASE_URL zeigt auf den Reverse Proxy. `make stack-smoke` startet die Tests in einem Container
 * im Compose-Netz und setzt BASE_URL=http://proxy:8080.
 */
export default defineConfig({
  testDir: 'tests',
  // Die Tests teilen sich eine DB; nacheinander ist einfacher zu lesen und schnell genug.
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:8088',
    locale: 'de-DE',
    // Bei Fehlern: Trace zum Nachvollziehen (npx playwright show-trace …)
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
