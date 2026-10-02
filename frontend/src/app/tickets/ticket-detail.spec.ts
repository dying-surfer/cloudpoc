import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { Ticket } from './ticket.model';
import TicketDetail from './ticket-detail';

@Component({ template: 'Liste' })
class ListStub {}

describe('TicketDetail', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  const dialog = { open: vi.fn() };
  const snackBar = { open: vi.fn() };

  const ticket: Ticket = {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    title: 'Drucker streikt',
    description: 'Papierstau im 2. OG',
    status: 'open',
    priority: 'high',
    assignee: 'alice',
    dueDate: '2026-12-31',
    createdAt: '2026-10-01T10:00:00+00:00',
    updatedAt: '2026-10-01T10:00:00+00:00',
    version: 3,
  };
  const url = `/api/tickets/${ticket.id}`;

  beforeEach(async () => {
    dialog.open.mockReset();
    snackBar.open.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'tickets', component: ListStub },
            { path: 'tickets/new', component: TicketDetail },
            { path: 'tickets/:id', component: TicketDetail },
          ],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  /** Laufende Navigationen und Promises abschließen, dann Effekte und Rendering ausführen. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }

  async function openTicket(): Promise<void> {
    await harness.navigateByUrl(`/tickets/${ticket.id}`);
    await settle();
    http.expectOne(url).flush(ticket);
    await settle();
  }

  function element(): HTMLElement {
    return harness.routeNativeElement!;
  }

  function button(label: string): HTMLButtonElement {
    const found = [...element().querySelectorAll('button')].find((b) =>
      b.textContent?.trim().includes(label),
    );
    if (!found) {
      throw new Error(`Button "${label}" not found`);
    }
    return found;
  }

  function type(selector: string, value: string): void {
    const input = element().querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    TestBed.tick();
  }

  it('does not send a new ticket without title', async () => {
    await harness.navigateByUrl('/tickets/new');
    await settle();

    button('Anlegen').click();
    await settle();

    expect(element().textContent).toContain('Bitte einen Titel eingeben.');
    // afterEach prüft, dass kein Request rausging.
  });

  it('creates a ticket and opens it', async () => {
    await harness.navigateByUrl('/tickets/new');
    await settle();
    type('input', '  Neuer Laptop  ');

    button('Anlegen').click();
    await settle();
    const req = http.expectOne('/api/tickets');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      title: 'Neuer Laptop',
      description: null,
      status: 'open',
      priority: 'medium',
      assignee: null,
      dueDate: null,
    });
    req.flush({ ...ticket, title: 'Neuer Laptop' }, { status: 201, statusText: 'Created' });
    await settle();

    expect(TestBed.inject(Router).url).toBe(`/tickets/${ticket.id}`);
    http.expectOne(url).flush(ticket);
  });

  it('saves changes with the loaded version', async () => {
    await openTicket();
    expect(button('Speichern').disabled).toBe(true); // nichts geändert

    type('input', 'Drucker streikt wieder');
    button('Speichern').click();
    await settle();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({ title: 'Drucker streikt wieder', version: 3 });
    req.flush({ ...ticket, title: 'Drucker streikt wieder', version: 4 });
    await settle();

    expect(element().textContent).toContain('Version 4');
    expect(button('Speichern').disabled).toBe(true); // wieder unverändert
  });

  it('shows violations from the server at the field', async () => {
    await openTicket();
    type('input', 'x');

    button('Speichern').click();
    await settle();
    http.expectOne(url).flush(
      {
        type: 'about:blank',
        title: 'Unprocessable Content',
        status: 422,
        violations: [{ field: 'title', message: 'Title is already taken.' }],
      },
      { status: 422, statusText: 'Unprocessable Content' },
    );
    await settle();

    expect(element().querySelector('mat-error')?.textContent).toContain('Title is already taken.');
  });

  it('offers to reload after a conflict', async () => {
    await openTicket();
    type('input', 'Meine Änderung');

    button('Speichern').click();
    await settle();
    http
      .expectOne(url)
      .flush(
        { type: 'about:blank', title: 'Conflict', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();
    expect(element().textContent).toContain('inzwischen geändert');

    button('Neu laden').click();
    await settle();
    http.expectOne(url).flush({ ...ticket, title: 'Fremde Änderung', version: 4 });
    await settle();

    expect(element().textContent).not.toContain('inzwischen geändert');
    expect(element().querySelector('input')!.value).toBe('Fremde Änderung');
  });

  it('closes a ticket', async () => {
    await openTicket();

    button('Schließen').click();
    await settle();
    const req = http.expectOne(`${url}/close`);
    expect(req.request.method).toBe('POST');
    req.flush({ ...ticket, status: 'done', version: 4 });
    await settle();

    expect(() => button('Schließen')).toThrow(); // erledigt: kein Schließen mehr
  });

  it('deletes only after confirmation', async () => {
    await openTicket();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });

    button('Löschen').click();
    await settle();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(TestBed.inject(Router).url).toBe('/tickets');
  });

  it('keeps the ticket when deletion is cancelled', async () => {
    await openTicket();
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });

    button('Löschen').click();
    await settle();

    expect(TestBed.inject(Router).url).toBe(`/tickets/${ticket.id}`);
  });
});
