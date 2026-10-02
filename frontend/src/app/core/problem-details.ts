import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, throwError } from 'rxjs';

/** Fehlerantwort nach RFC 9457, so wie sie der ProblemDetailsListener im Backend erzeugt. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** Nur bei 422: ein Eintrag pro ungültigem Feld. */
  violations?: Violation[];
}

export interface Violation {
  /** Property-Pfad aus dem Backend, z. B. "title". */
  field: string;
  message: string;
}

/** Liefert die Problem Details aus einer Fehlerantwort, falls der Body welche enthält. */
export function problemDetailsOf(error: unknown): ProblemDetails | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }
  const body: unknown = error.error;
  if (typeof body === 'object' && body !== null && 'status' in body && 'title' in body) {
    return body as ProblemDetails;
  }
  return null;
}

/**
 * Zeigt jeden Fehler der API als Snackbar und reicht ihn danach weiter, damit der Aufrufer
 * trotzdem reagieren kann (z. B. Spinner beenden).
 *
 * Ausnahme: 422 mit Violations. Diese Fehler gehören an die Formularfelder, nicht in eine
 * Snackbar; das übernimmt das Formular selbst.
 */
export const problemDetailsInterceptor: HttpInterceptorFn = (req, next) => {
  const snackBar = inject(MatSnackBar);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && req.url.startsWith('/api')) {
        const problem = problemDetailsOf(error);
        if (!(error.status === 422 && problem?.violations?.length)) {
          snackBar.open(errorMessage(error, problem), 'OK', { duration: 8000 });
        }
      }
      return throwError(() => error);
    }),
  );
};

/** Deutsche Meldung für die häufigen Fälle, sonst Titel und Detail aus dem Backend. */
export function errorMessage(error: HttpErrorResponse, problem: ProblemDetails | null): string {
  switch (error.status) {
    case 0:
      return 'Server nicht erreichbar. Bitte später erneut versuchen.';
    case 404:
      return 'Nicht gefunden. Vielleicht wurde der Eintrag inzwischen gelöscht.';
    case 409:
      return 'Das Ticket wurde inzwischen geändert. Bitte neu laden und die Änderung wiederholen.';
  }
  if (problem) {
    return problem.detail ? `${problem.title}: ${problem.detail}` : problem.title;
  }
  return `Fehler ${error.status}: ${error.statusText}`;
}
