/**
 * Typen der Ticket-API. Sie spiegeln die DTOs im Backend (backend/src/Dto) und müssen bei
 * Änderungen dort von Hand nachgezogen werden.
 */

export const TICKET_STATUSES = ['open', 'in_progress', 'done'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_SORT_FIELDS = [
  'title',
  'status',
  'priority',
  'assignee',
  'dueDate',
  'createdAt',
  'updatedAt',
] as const;
export type TicketSortField = (typeof TICKET_SORT_FIELDS)[number];
/** Feldname, mit "-" davor absteigend, z. B. "-dueDate". */
export type TicketSort = TicketSortField | `-${TicketSortField}`;

/** TicketView: so liefert die API ein Ticket aus. */
export interface Ticket {
  id: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  assignee: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  /** RFC 3339 */
  createdAt: string;
  /** RFC 3339 */
  updatedAt: string;
  /** Beim Speichern zurückschicken (Optimistic Locking). */
  version: number;
}

/** TicketPage: eine Seite der Ticketliste. */
export interface TicketPage {
  items: Ticket[];
  /** Anzahl aller Treffer über alle Seiten. */
  total: number;
  page: number;
  pageSize: number;
}

/** TicketInput: Body von POST /api/tickets. */
export interface TicketInput {
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  assignee: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
}

/** TicketUpdateInput: Body von PUT /api/tickets/{id}, ersetzt das ganze Ticket. */
export interface TicketUpdateInput extends TicketInput {
  version: number;
}

/** TicketListQuery: alle Filter optional, im Backend per UND verknüpft. */
export interface TicketQuery {
  q?: string | null;
  status?: TicketStatus | null;
  priority?: TicketPriority | null;
  assignee?: string | null;
  /** YYYY-MM-DD, fällig strikt vor diesem Datum. */
  dueBefore?: string | null;
  sort?: TicketSort | null;
  page?: number | null;
  pageSize?: number | null;
}
