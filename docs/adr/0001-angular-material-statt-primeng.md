# ADR 0001: Angular Material statt PrimeNG

- **Status:** angenommen
- **Datum:** 2026-10-01

## Kontext

Für M3 brauchen wir eine UI-Bibliothek für Angular 22: Tabelle mit serverseitigem Paging und
Sortieren, Formularfelder (Text, Auswahl, Datum), Dialoge und Benachrichtigungen. Geprüft wurden
PrimeNG und Angular Material. PrimeNG war zunächst gesetzt, weil sein `p-table` im lazy-Modus
direkt zur Paginierung der API passt.

Beim Installieren von PrimeNG 22 hat sich gezeigt:

- **Lizenz:** Bis PrimeNG 21 stand die Community-Version unter MIT. Ab PrimeNG 22 (ebenso
  `@primeuix/themes` 3 und `primeicons` 8) gilt die „PrimeUI License“. Sie ist nur für
  Einzelpersonen, Non-Profits und sehr kleine Firmen kostenlos, muss jährlich erneuert werden und
  braucht einen **Lizenzschlüssel** im Code. Ohne gültigen Schlüssel zeigt die App einen
  Lizenzhinweis. Die freie PrimeNG 21 verlangt Angular 21.
- **Formulare:** PrimeNG-Komponenten unterstützen nur `ControlValueAccessor`, also Reactive Forms.
  Signal Forms könnten sie nur über einen Kompatibilitätspfad ansprechen, den Angular ausdrücklich
  als Notlösung für ältere Komponenten beschreibt.

## Entscheidung

Wir nutzen **Angular Material** (MIT) mit **Signal Forms**. Material 22 bindet Signal Forms
direkt ein (`input`, `select`, `datepicker`, `form-field`), und es wird zusammen mit Angular
veröffentlicht, Major-Upgrades laufen also im Gleichschritt.

## Folgen

- Kein Lizenzschlüssel im Repo oder im Bundle, keine jährliche Erneuerung, keine Abhängigkeit
  davon, dass das Projekt die Bedingungen der Community-Lizenz erfüllt.
- Das serverseitige Paging verdrahten wir selbst: `mat-paginator` und `matSort` melden Seite und
  Sortierung über Events, daraus bauen wir die API-Anfrage. Das ist etwas mehr Code als mit
  `p-table` im lazy-Modus.
- Material gibt mit Material Design 3 eine Optik vor. Anpassen lässt sie sich über
  Design-Tokens (CSS-Variablen), nicht beliebig.
