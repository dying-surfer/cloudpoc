import { DatePipe, Location } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  FormField,
  form,
  maxLength,
  required,
  submit,
  ValidationError,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { confirm } from '../core/confirm-dialog';
import { problemDetailsOf } from '../core/problem-details';
import { TicketApiService } from './ticket-api.service';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  Ticket,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TicketInput,
  TicketPriority,
  TicketStatus,
} from './ticket.model';

/**
 * Modell des Formulars. Textfelder sind immer Strings ('' statt null), weil Eingabefelder
 * nur Strings kennen; erst toInput() macht daraus wieder null für die API.
 */
interface TicketFormModel {
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee: string;
  /** YYYY-MM-DD, so wie <input type="date"> es liefert. */
  dueDate: string;
}

const EMPTY: TicketFormModel = {
  title: '',
  description: '',
  status: 'open',
  priority: 'medium',
  assignee: '',
  dueDate: '',
};

/**
 * Ticket anlegen (/tickets/new) oder bearbeiten (/tickets/:id) als Signal Form.
 *
 * Gespeichert wird mit der Version, die zuletzt geladen wurde. Hat jemand anderes das Ticket
 * inzwischen geändert, antwortet das Backend mit 409; dann bietet die Seite "Neu laden" an.
 */
@Component({
  selector: 'app-ticket-detail',
  imports: [
    DatePipe,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './ticket-detail.html',
  styleUrl: './ticket-detail.css',
})
export default class TicketDetail {
  private readonly api = inject(TicketApiService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** Route-Parameter :id; fehlt bei /tickets/new. */
  readonly id = input<string>();

  protected readonly isNew = computed(() => this.id() === undefined);

  /** Ohne id bleibt die Resource im Zustand "idle" und lädt nichts. */
  protected readonly ticket = rxResource({
    params: () => this.id(),
    stream: ({ params }) => this.api.get(params),
  });

  /** Das geladene Ticket oder undefined (neu, lädt noch, Fehler). */
  protected readonly loaded = computed(() =>
    this.ticket.hasValue() ? this.ticket.value() : undefined,
  );

  /** Formularwerte; folgen dem geladenen Ticket, bis der User etwas ändert. */
  private readonly model = linkedSignal(() => {
    const ticket = this.loaded();
    return ticket ? toModel(ticket) : EMPTY;
  });

  protected readonly form = form(this.model, (path) => {
    required(path.title, { message: 'Bitte einen Titel eingeben.' });
    maxLength(path.title, 200, { message: 'Höchstens 200 Zeichen.' });
    maxLength(path.description, 10000, { message: 'Höchstens 10.000 Zeichen.' });
    maxLength(path.assignee, 100, { message: 'Höchstens 100 Zeichen.' });
  });

  /** true nach einem 409: Die geladene Version ist veraltet. */
  protected readonly conflict = signal(false);
  /** Läuft gerade Schließen oder Löschen? (Speichern meldet form().submitting().) */
  protected readonly busy = signal(false);

  protected readonly statuses = TICKET_STATUSES;
  protected readonly priorities = TICKET_PRIORITIES;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly priorityLabels = PRIORITY_LABELS;

  protected async save(): Promise<void> {
    await submit(this.form, async (fields) => {
      const input = toInput(fields().value());
      const id = this.id();
      try {
        if (id === undefined) {
          const created = await firstValueFrom(this.api.create(input));
          this.snackBar.open('Ticket angelegt.', undefined, { duration: 3000 });
          await this.router.navigate(['/tickets', created.id], { replaceUrl: true });
        } else {
          const version = this.loaded()!.version;
          this.show(await firstValueFrom(this.api.update(id, { ...input, version })));
          this.snackBar.open('Gespeichert.', undefined, { duration: 3000 });
        }
        return undefined;
      } catch (error) {
        return this.serverErrors(error);
      }
    });
  }

  /** Setzt das Formular auf den zuletzt geladenen Stand zurück. */
  protected discard(): void {
    this.form().reset(toModel(this.loaded()!));
  }

  /** Lädt den aktuellen Stand vom Server; eigene, ungespeicherte Änderungen gehen verloren. */
  protected async reload(): Promise<void> {
    await this.run(async (id) => this.show(await firstValueFrom(this.api.get(id))));
  }

  protected async close(): Promise<void> {
    await this.run(async (id) => {
      this.show(await firstValueFrom(this.api.close(id)));
      this.snackBar.open('Ticket geschlossen.', undefined, { duration: 3000 });
    });
  }

  protected async delete(): Promise<void> {
    const confirmed = await firstValueFrom(
      confirm(this.dialog, {
        title: 'Ticket löschen?',
        message: `„${this.loaded()?.title}“ wird endgültig gelöscht.`,
        confirmLabel: 'Löschen',
      }),
    );
    if (!confirmed) {
      return;
    }
    await this.run(async (id) => {
      await firstValueFrom(this.api.delete(id), { defaultValue: undefined });
      this.snackBar.open('Ticket gelöscht.', undefined, { duration: 3000 });
      this.back();
    });
  }

  /**
   * Zurück zur Liste. Kam der User aus der App (meist aus der Liste), geht es per Browser-History
   * zurück; so bleiben Filter, Sortierung und Seite in der URL erhalten.
   */
  protected back(): void {
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) {
      this.location.back();
    } else {
      void this.router.navigate(['/tickets']);
    }
  }

  /** Zeigt einen Stand vom Server an und setzt das Formular darauf zurück (nicht mehr "dirty"). */
  private show(ticket: Ticket): void {
    this.ticket.set(ticket);
    this.form().reset(toModel(ticket));
    this.conflict.set(false);
  }

  /** Führt eine Aktion für das aktuelle Ticket aus; Fehler zeigt bereits der Interceptor an. */
  private async run(action: (id: string) => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action(this.id()!);
    } catch (error) {
      this.serverErrors(error);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Übersetzt eine Fehlerantwort in Formularfehler: Violations aus einem 422 landen am passenden
   * Feld (unbekannte Felder am Formular selbst). Ein 409 schaltet den Konflikt-Hinweis ein.
   */
  private serverErrors(error: unknown): ValidationError.WithOptionalFieldTree[] | undefined {
    const problem = problemDetailsOf(error);
    if (problem?.status === 409) {
      this.conflict.set(true);
    }
    return problem?.violations?.map(({ field, message }) => ({
      kind: 'server',
      message,
      fieldTree: field in EMPTY ? this.form[field as keyof TicketFormModel] : undefined,
    }));
  }
}

function toModel(ticket: Ticket): TicketFormModel {
  return {
    title: ticket.title,
    description: ticket.description ?? '',
    status: ticket.status,
    priority: ticket.priority,
    assignee: ticket.assignee ?? '',
    dueDate: ticket.dueDate ?? '',
  };
}

function toInput(model: TicketFormModel): TicketInput {
  return {
    title: model.title.trim(),
    description: model.description.trim() || null,
    status: model.status,
    priority: model.priority,
    assignee: model.assignee.trim() || null,
    dueDate: model.dueDate || null,
  };
}
