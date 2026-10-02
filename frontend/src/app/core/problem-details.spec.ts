import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { problemDetailsInterceptor } from './problem-details';

describe('problemDetailsInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  const snackBar = { open: vi.fn() };

  beforeEach(() => {
    snackBar.open.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([problemDetailsInterceptor])),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Schickt einen Request, beantwortet ihn mit einem Fehler und gibt den Fehler zurück. */
  async function fail(url: string, status: number, body: object | null = null): Promise<unknown> {
    const result = firstValueFrom(client.get(url)).catch((error: unknown) => error);
    http.expectOne(url).flush(body, { status, statusText: 'Error' });
    return result;
  }

  it('shows title and detail from the problem details', async () => {
    await fail('/api/tickets', 400, {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Invalid sort field.',
    });

    expect(snackBar.open).toHaveBeenCalledWith('Bad Request: Invalid sort field.', 'OK', {
      duration: 8000,
    });
  });

  it('explains a conflict in German', async () => {
    await fail('/api/tickets/1', 409, { type: 'about:blank', title: 'Conflict', status: 409 });

    expect(snackBar.open.mock.calls[0][0]).toMatch(/inzwischen geändert/);
  });

  it('leaves validation errors with violations to the form', async () => {
    const error = await fail('/api/tickets', 422, {
      type: 'about:blank',
      title: 'Unprocessable Content',
      status: 422,
      violations: [{ field: 'title', message: 'This value should not be blank.' }],
    });

    expect(snackBar.open).not.toHaveBeenCalled();
    expect(error).toMatchObject({ status: 422 });
  });

  it('rethrows the error so callers can react', async () => {
    const error = await fail('/api/tickets/1', 404);

    expect(error).toMatchObject({ status: 404 });
    expect(snackBar.open).toHaveBeenCalledOnce();
  });

  it('ignores requests outside /api', async () => {
    await fail('/config.json', 404);

    expect(snackBar.open).not.toHaveBeenCalled();
  });
});
