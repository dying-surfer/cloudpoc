# cloudpoc – Hinweise für Claude

Ziel und Meilensteine: siehe `ROADMAP.md`. Lokale Umgebung: siehe `docs/dev.md`.

## Arbeitsweise

- Der User lernt das Setup und will mitverfolgen: **auf Deutsch erklären**, was passiert und warum.
- In **kleinen Schritten** arbeiten. Nach jedem Schritt: erklären → **committen** → Rückfragen ermöglichen,
  bevor es weitergeht.
- Ein Branch pro Meilenstein (`m<N>-<thema>`, z. B. `m2-ticket-api`), Basis ist `main`.
  Abschluss per `git merge --no-ff`, danach den Branch löschen.
- Commit-Messages auf Englisch: kurze Betreffzeile, Body mit dem Warum.
- Fehler und Stolpersteine ehrlich benennen und in `docs/dev.md` (Fehlersuche) festhalten.

## Umgebung

- Claude läuft **im Devcontainer** (Service `workspace`, User `dev`, Repo unter `/workspaces/cloudpoc`).
- Host: Bluefin (atomares Fedora) mit **rootless Podman**, kein Docker.
- **Im Container gibt es kein Podman.** Container neu bauen oder Images bauen kann nur der User auf dem Host
  (VS Code: *Dev Containers: Rebuild Container*). Ab M4 (Prod-Images) dafür eine Lösung besprechen.
- Die `make dev-*`-Targets gehen nur auf dem **Host** (sie rufen `podman compose` auf). Die `make backend-*`-Targets
  und `make test` gehen überall: mit Podman per `exec` im Devcontainer, ohne Podman direkt.
- DB: Service `db` (postgres:17) als Wegwerf-DB auf tmpfs. `psql` ist über `PGHOST`/`PGUSER`/… vorkonfiguriert,
  Symfony nutzt `DATABASE_URL` aus der Container-Umgebung.

## Stand

- **M1** (Repo-Skeleton & Devcontainer): fertig, in `main` gemergt.
- **M2** (Backend: Ticket-API): fertig, in `main` gemergt. Konventionen im Backend:
  - Request-/Response-DTOs in `src/Dto` (nie die Entity serialisieren), Fehler als Problem Details
    über `ProblemDetailsListener`, Optimistic Locking über `version` im Body (409 bei Konflikt).
  - Eingabe-DTOs nehmen Enums und Daten als **String** an und prüfen sie mit Constraints (`Choice`, `Date`);
    so meldet die API alle Fehler auf einmal. Umwandlung erst danach (`statusEnum()` usw.).
  - Checks: `make test` bzw. `cd backend && composer check` (cs, phpstan, phpunit gegen `app_test`).
  - Factories, Stories, Fixtures liegen in `backend/fixtures/` (Namespace `App\Fixtures`, nur `autoload-dev`,
    Services nur in dev/test), damit ein `--no-dev`-Build sie nicht enthält. Nicht nach `src/` legen.
  - Demo-Daten: `make backend-fixtures`. Dev-Server: siehe `docs/dev.md` (Backend starten).
- **M3** (Frontend): fertig, in `main` gemergt. Konventionen im Frontend:
  - Angular 22, Standalone, zoneless, Signals; Angular Material (M3) mit Nord-Farben
    (`src/_theme-colors.scss` per Schematic erzeugt, Flächen/Text per `mat.theme-overrides` in `styles.scss`).
  - API-Typen in `tickets/ticket.model.ts` spiegeln die Backend-DTOs von Hand; bei DTO-Änderungen nachziehen.
  - Listen-Zustand (Filter, Sortierung, Seite) nur in den Query-Params → Signal-Inputs → `rxResource`.
  - Formulare als Signal Forms (`@angular/forms/signals`, `[formField]`), Server-Violations aus `submit()` zurückgeben.
  - API-Fehler zeigt `problemDetailsInterceptor` als Snackbar, außer 422 mit Violations (gehören ans Formular).
  - UI-Texte auf Deutsch, Code-Kommentare auf Deutsch wie im Bestand.
  - Checks: `cd frontend && npm run check` (prettier, eslint, vitest, build). In Komponententests mit
    `HttpTestingController` vor `expectOne()` nicht `whenStable()` aufrufen (wartet auf den Request).
- **M4** (Prod-Images & Compose-Stack): als Nächstes. Images bauen geht nur auf dem Host (kein Podman im
  Container), dafür vorher eine Lösung mit dem User besprechen.
