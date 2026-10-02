import { expect, test } from '@playwright/test';

test('Startseite zeigt die Ticketliste und das Banner aus config.json', async ({
  page,
  request,
}) => {
  // config.json ist pro Umgebung gemountet; das Banner muss genau deren Text zeigen.
  const config = (await (await request.get('/config.json')).json()) as { banner?: string };

  const tickets = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tickets');
  await page.goto('/');

  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
  expect((await tickets).status()).toBe(200);
  await expect(page.getByText('Tickets konnten nicht geladen werden')).toHaveCount(0);
  if (config.banner) {
    await expect(page.getByRole('status').filter({ hasText: config.banner })).toBeVisible();
  }
});

test.describe('Ticket anlegen, finden und löschen', () => {
  // Eindeutiger Titel, damit sich parallele Läufe und vorhandene Daten nicht stören
  const title = `Smoke-Test ${new Date().toISOString()}`;

  // Aufräumen, auch wenn der Test mittendrin scheitert: Die Stack-DB ist persistent.
  test.afterEach(async ({ request }) => {
    const response = await request.get('/api/tickets', { params: { q: title } });
    const { items } = (await response.json()) as { items: { id: string; title: string }[] };
    for (const ticket of items.filter((t) => t.title === title)) {
      await request.delete(`/api/tickets/${ticket.id}`);
    }
  });

  test('über die Oberfläche', async ({ page, request }) => {
    await page.goto('/tickets');
    await page.getByRole('link', { name: 'Neues Ticket' }).click();
    await page.getByLabel('Titel').fill(title);
    await page.getByLabel('Beschreibung').fill('Angelegt vom Playwright-Smoke-Test.');
    await page.getByRole('button', { name: 'Anlegen' }).click();

    await expect(page.getByText('Ticket angelegt.')).toBeVisible();
    await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop()!;

    // In der Liste über die Suche wiederfinden (filtert serverseitig, prüft also die DB)
    await page.goto(`/tickets?q=${encodeURIComponent(title)}`);
    await page.getByRole('link', { name: title }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    await page.getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByText('Ticket gelöscht.')).toBeVisible();

    expect((await request.get(`/api/tickets/${id}`)).status()).toBe(404);
  });
});
