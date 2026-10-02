import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { TicketApiService } from './ticket-api.service';
import { Ticket, TicketInput } from './ticket.model';

describe('TicketApiService', () => {
  let api: TicketApiService;
  let http: HttpTestingController;

  const ticket: Ticket = {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    title: 'Drucker streikt',
    description: null,
    status: 'open',
    priority: 'high',
    assignee: 'alice',
    dueDate: '2026-12-31',
    createdAt: '2026-10-01T10:00:00+00:00',
    updatedAt: '2026-10-01T10:00:00+00:00',
    version: 1,
  };
  const input: TicketInput = {
    title: 'Drucker streikt',
    description: null,
    status: 'open',
    priority: 'high',
    assignee: null,
    dueDate: null,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(TicketApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends only the filters that are set', async () => {
    const page = { items: [ticket], total: 1, page: 2, pageSize: 20 };
    const result = firstValueFrom(
      api.list({ q: 'drucker', status: 'open', priority: null, assignee: '', page: 2 }),
    );

    const req = http.expectOne((r) => r.url === '/api/tickets');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual(['q', 'status', 'page']);
    expect(req.request.params.get('page')).toBe('2');
    req.flush(page);

    expect(await result).toEqual(page);
  });

  it('loads a single ticket', async () => {
    const result = firstValueFrom(api.get(ticket.id));
    http.expectOne(`/api/tickets/${ticket.id}`).flush(ticket);

    expect(await result).toEqual(ticket);
  });

  it('creates a ticket with POST', async () => {
    const result = firstValueFrom(api.create(input));
    const req = http.expectOne('/api/tickets');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush(ticket, { status: 201, statusText: 'Created' });

    expect(await result).toEqual(ticket);
  });

  it('updates a ticket with PUT including the version', async () => {
    const result = firstValueFrom(api.update(ticket.id, { ...input, version: 1 }));
    const req = http.expectOne(`/api/tickets/${ticket.id}`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ ...input, version: 1 });
    req.flush({ ...ticket, version: 2 });

    expect((await result).version).toBe(2);
  });

  it('deletes a ticket', async () => {
    const result = firstValueFrom(api.delete(ticket.id), { defaultValue: undefined });
    const req = http.expectOne(`/api/tickets/${ticket.id}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    await result;
  });

  it('closes a ticket via the RPC endpoint', async () => {
    const result = firstValueFrom(api.close(ticket.id));
    const req = http.expectOne(`/api/tickets/${ticket.id}/close`);
    expect(req.request.method).toBe('POST');
    req.flush({ ...ticket, status: 'done' });

    expect((await result).status).toBe('done');
  });
});
