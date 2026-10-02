import { Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';

/** Deutsche Texte für mat-paginator (Material liefert nur Englisch mit). */
@Injectable()
export class GermanPaginatorIntl extends MatPaginatorIntl {
  override itemsPerPageLabel = 'Pro Seite:';
  override nextPageLabel = 'Nächste Seite';
  override previousPageLabel = 'Vorige Seite';
  override firstPageLabel = 'Erste Seite';
  override lastPageLabel = 'Letzte Seite';

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0) {
      return '0 von 0';
    }
    const start = page * pageSize + 1;
    const end = Math.min((page + 1) * pageSize, length);
    return `${start}–${end} von ${length}`;
  };
}
