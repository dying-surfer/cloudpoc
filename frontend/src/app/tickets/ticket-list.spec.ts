import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Ticket, TicketPage } from './ticket.model';
import TicketList from './ticket-list';

describe('TicketList', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  const ticket: Ticket = {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    title: 'Drucker streikt',
    description: null,
    status: 'in_progress',
    priority: 'high',
    assignee: 'alice',
    dueDate: '2026-12-31',
    createdAt: '2026-10-01T10:00:00+00:00',
    updatedAt: '2026-10-01T10:00:00+00:00',
    version: 1,
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'tickets', component: TicketList }], withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  /** Öffnet die URL und beantwortet den Listen-Request; gibt die gesendeten Parameter zurück. */
  async function open(
    url: string,
    page: Partial<TicketPage> = {},
  ): Promise<Record<string, string>> {
    await harness.navigateByUrl(url, TicketList);
    return respond(page);
  }

  async function respond(page: Partial<TicketPage> = {}): Promise<Record<string, string>> {
    // Laufende Navigation abschließen lassen, dann Effekte ausführen. Nicht whenStable(): Das
    // würde auch auf den Request warten, den wir erst unten beantworten.
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
    const req = http.expectOne((r) => r.url === '/api/tickets');
    const params = Object.fromEntries(
      req.request.params.keys().map((key) => [key, req.request.params.get(key)!]),
    );
    req.flush({ items: [ticket], total: 1, page: 1, pageSize: 20, ...page });
    await harness.fixture.whenStable();
    return params;
  }

  function url(): string {
    return TestBed.inject(Router).url;
  }

  it('loads the first page with default sorting', async () => {
    expect(await open('/tickets')).toEqual({ sort: '-createdAt', page: '1', pageSize: '20' });
  });

  it('passes the filters from the URL to the API', async () => {
    const params = await open(
      '/tickets?q=drucker&status=open&assignee=alice&dueBefore=2026-12-31&sort=title&page=3&pageSize=50',
    );

    expect(params).toEqual({
      q: 'drucker',
      status: 'open',
      assignee: 'alice',
      dueBefore: '2026-12-31',
      sort: 'title',
      page: '3',
      pageSize: '50',
    });
  });

  it('drops invalid values from the URL instead of sending them', async () => {
    const params = await open('/tickets?status=bogus&sort=-password&page=-1&pageSize=7');

    expect(params).toEqual({ sort: '-createdAt', page: '1', pageSize: '20' });
  });

  it('shows the tickets with German labels', async () => {
    await open('/tickets');
    const row: HTMLElement = harness.routeNativeElement!.querySelector('tr.mat-mdc-row')!;

    expect(row.textContent).toContain('Drucker streikt');
    expect(row.textContent).toContain('In Arbeit');
    expect(row.textContent).toContain('Hoch');
    expect(row.textContent).toContain('31.12.2026');
  });

  it('sorts via the column header and starts again on page 1', async () => {
    await open('/tickets?page=2');
    const header: HTMLElement = harness.routeNativeElement!.querySelector('th.mat-column-title')!;

    header.click();
    await respond();

    expect(url()).toBe('/tickets?sort=title');
  });

  it('resets the filters but keeps the sorting', async () => {
    await open('/tickets?status=open&q=drucker&sort=title');
    const reset = [...harness.routeNativeElement!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Filter zurücksetzen'),
    )!;

    reset.click();
    await respond();

    expect(url()).toBe('/tickets?sort=title');
  });

  it('shows an empty state for filters without results', async () => {
    await open('/tickets?status=done', { items: [], total: 0 });

    expect(harness.routeNativeElement!.textContent).toContain('Keine Tickets für diese Filter.');
  });
});
