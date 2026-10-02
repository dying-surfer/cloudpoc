import { expect, test } from '@playwright/test';

// Der Proxy muss diese Pfade ans Backend geben, nicht an den SPA-Fallback des Frontends
// (der würde mit index.html und 200 antworten).

test('Health-Endpoints antworten', async ({ request }) => {
  for (const path of ['/healthz', '/readyz']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain('application/json');
  }
});

test('Fehler unter /api kommen als Problem Details vom Backend', async ({ request }) => {
  const response = await request.get('/api/tickets/00000000-0000-7000-8000-000000000000');
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toContain('application/problem+json');
});
