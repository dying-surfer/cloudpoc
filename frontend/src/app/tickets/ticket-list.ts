import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, Signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorIntl, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort, SortDirection } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { GermanPaginatorIntl } from '../core/german-paginator-intl';
import { TicketApiService } from './ticket-api.service';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TICKET_PRIORITIES,
  TICKET_SORT_FIELDS,
  TICKET_STATUSES,
  TicketPage,
  TicketPriority,
  TicketQuery,
  TicketSort,
  TicketSortField,
  TicketStatus,
} from './ticket.model';

const DEFAULT_SORT: TicketSort = '-createdAt';
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZES = [10, 20, 50, 100];
/** Wartezeit nach dem letzten Tastendruck, bevor ein Textfilter die URL ändert. */
const TEXT_DEBOUNCE_MS = 300;

type TextFilter = 'q' | 'assignee';

/**
 * Ticketliste unter /tickets.
 *
 * Die URL ist die einzige Quelle für Filter, Sortierung und Seite: Der Router schreibt die
 * Query-Params in die Inputs (withComponentInputBinding), daraus entsteht die Query für die
 * API. Bedienelemente ändern nur die URL. So lassen sich Ansichten verlinken, und Zurück/Vor
 * im Browser funktioniert.
 */
@Component({
  selector: 'app-ticket-list',
  imports: [
    DatePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    RouterLink,
  ],
  templateUrl: './ticket-list.html',
  styleUrl: './ticket-list.css',
  // Hier statt in app.config.ts: Sonst lädt schon der App-Start das ganze Paginator-Paket.
  providers: [{ provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }],
})
export default class TicketList {
  private readonly api = inject(TicketApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // Query-Params, so wie sie in der URL stehen (fehlender Parameter = undefined).
  readonly q = input<string>();
  readonly status = input<string>();
  readonly priority = input<string>();
  readonly assignee = input<string>();
  readonly dueBefore = input<string>();
  readonly sort = input<string>();
  readonly page = input<string>();
  readonly pageSize = input<string>();

  /**
   * Bereinigte Query: Unbekannte Werte (z. B. von Hand in die URL getippt) fallen weg, statt
   * einen 400er vom Backend auszulösen.
   */
  protected readonly query = computed(() => {
    const sort = this.sort();
    const dueBefore = this.dueBefore() ?? '';
    const pageSize = Number(this.pageSize());
    return {
      q: this.q() || null,
      status: oneOf(this.status(), TICKET_STATUSES),
      priority: oneOf(this.priority(), TICKET_PRIORITIES),
      assignee: this.assignee() || null,
      dueBefore: /^\d{4}-\d{2}-\d{2}$/.test(dueBefore) ? dueBefore : null,
      sort: isSort(sort) ? sort : DEFAULT_SORT,
      page: positiveInt(this.page()) ?? 1,
      pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    } satisfies TicketQuery;
  });

  /** Lädt neu, sobald sich die Query ändert; ein älterer, noch laufender Request wird abgebrochen. */
  protected readonly tickets = rxResource({
    params: () => this.query(),
    stream: ({ params }) => this.api.list(params),
  });

  /**
   * Die zuletzt geladene Seite. Während eine neue Seite lädt, ist tickets.value() leer; ohne
   * diesen Zwischenspeicher würde die Tabelle bei jedem Filter kurz verschwinden.
   */
  protected readonly lastPage: Signal<TicketPage | undefined> = linkedSignal<
    TicketPage | undefined,
    TicketPage | undefined
  >({
    source: () => (this.tickets.hasValue() ? this.tickets.value() : undefined),
    computation: (page, previous) => page ?? previous?.value,
  });

  protected readonly sortActive = computed(() => this.query().sort.replace(/^-/, ''));
  protected readonly sortDirection = computed<SortDirection>(() =>
    this.query().sort.startsWith('-') ? 'desc' : 'asc',
  );

  // Eingabefelder der Textfilter. Sie folgen der URL (z. B. bei Zurück im Browser), behalten
  // aber den getippten Text, solange er sich nur in Leerzeichen am Rand unterscheidet; sonst
  // würde das Leerzeichen zwischen zwei Wörtern beim Tippen verschwinden.
  protected readonly qText = textField(this.q);
  protected readonly assigneeText = textField(this.assignee);
  private readonly textTimers: Partial<Record<TextFilter, ReturnType<typeof setTimeout>>> = {};

  protected readonly columns = ['title', 'status', 'priority', 'assignee', 'dueDate', 'createdAt'];
  protected readonly statuses = TICKET_STATUSES;
  protected readonly priorities = TICKET_PRIORITIES;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly pageSizes = PAGE_SIZES;

  protected readonly hasFilters = computed(() => {
    const { q, status, priority, assignee, dueBefore } = this.query();
    return [q, status, priority, assignee, dueBefore].some((value) => value !== null);
  });

  // Zellen in mat-table sind untypisiert (let ticket = any); die Methoden prüfen den Typ.
  protected statusLabel(status: TicketStatus): string {
    return STATUS_LABELS[status];
  }

  protected priorityLabel(priority: TicketPriority): string {
    return PRIORITY_LABELS[priority];
  }

  protected onText(name: TextFilter, value: string): void {
    (name === 'q' ? this.qText : this.assigneeText).set(value);
    clearTimeout(this.textTimers[name]);
    this.textTimers[name] = setTimeout(
      () => this.navigate({ [name]: value.trim() || null }),
      TEXT_DEBOUNCE_MS,
    );
  }

  protected onFilter(name: 'status' | 'priority' | 'dueBefore', value: string | null): void {
    this.navigate({ [name]: value || null });
  }

  protected onSort(sort: Sort): void {
    const value = sort.direction === 'desc' ? `-${sort.active}` : sort.active;
    this.navigate({ sort: sort.direction === '' || value === DEFAULT_SORT ? null : value });
  }

  protected onPage(event: PageEvent): void {
    this.navigate(
      {
        page: event.pageIndex === 0 ? null : event.pageIndex + 1,
        pageSize: event.pageSize === DEFAULT_PAGE_SIZE ? null : event.pageSize,
      },
      false,
    );
  }

  protected openTicket(id: string): void {
    void this.router.navigate([id], { relativeTo: this.route });
  }

  protected resetFilters(): void {
    for (const name of Object.keys(this.textTimers) as TextFilter[]) {
      clearTimeout(this.textTimers[name]);
    }
    this.navigate({ q: null, status: null, priority: null, assignee: null, dueBefore: null });
  }

  /**
   * Übernimmt geänderte Parameter in die URL. null entfernt einen Parameter, Standardwerte
   * bleiben so aus der URL heraus. Neue Filter oder Sortierung beginnen wieder auf Seite 1.
   */
  private navigate(params: Params, resetPage = true): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: resetPage ? { ...params, page: null } : params,
      queryParamsHandling: 'merge',
    });
  }
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

function isSort(value: string | undefined): value is TicketSort {
  return TICKET_SORT_FIELDS.includes(value?.replace(/^-/, '') as TicketSortField);
}

function positiveInt(value: string | undefined): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function textField(param: Signal<string | undefined>) {
  return linkedSignal<string | undefined, string>({
    source: param,
    computation: (value, previous) =>
      previous && previous.value.trim() === (value ?? '') ? previous.value : (value ?? ''),
  });
}
