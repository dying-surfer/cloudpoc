import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Ticket, TicketInput, TicketPage, TicketQuery, TicketUpdateInput } from './ticket.model';

/**
 * Zugriff auf /api/tickets. Die URLs sind relativ: Im Browser landet alles auf demselben Origin,
 * lokal leitet proxy.conf.json /api ans Backend weiter, später der Reverse Proxy (Same-Origin,
 * kein CORS).
 *
 * Fehler zeigt der problemDetailsInterceptor an; der Service reicht sie nur weiter.
 */
@Injectable({ providedIn: 'root' })
export class TicketApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/tickets';

  list(query: TicketQuery = {}): Observable<TicketPage> {
    // Leere Filter gar nicht erst senden: Das Backend würde "" als Wert prüfen und z. B. bei
    // status= mit 400 antworten.
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(key, value);
      }
    }
    return this.http.get<TicketPage>(this.baseUrl, { params });
  }

  get(id: string): Observable<Ticket> {
    return this.http.get<Ticket>(this.url(id));
  }

  create(input: TicketInput): Observable<Ticket> {
    return this.http.post<Ticket>(this.baseUrl, input);
  }

  /** Ersetzt das ganze Ticket; 409, wenn `version` nicht mehr aktuell ist. */
  update(id: string, input: TicketUpdateInput): Observable<Ticket> {
    return this.http.put<Ticket>(this.url(id), input);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(this.url(id));
  }

  /** Setzt den Status auf "done" (RPC-Endpunkt, braucht keine Version). */
  close(id: string): Observable<Ticket> {
    return this.http.post<Ticket>(`${this.url(id)}/close`, null);
  }

  private url(id: string): string {
    return `${this.baseUrl}/${encodeURIComponent(id)}`;
  }
}
