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
- Die `make dev-*`- und `make backend-*`-Targets sind für den **Host** gedacht (sie rufen `podman compose` auf).
  Im Container die Befehle direkt ausführen, z. B. `cd backend && composer install`.
- DB: Service `db` (postgres:17) als Wegwerf-DB auf tmpfs. `psql` ist über `PGHOST`/`PGUSER`/… vorkonfiguriert,
  Symfony nutzt `DATABASE_URL` aus der Container-Umgebung.

## Stand

- **M1** (Repo-Skeleton & Devcontainer): fertig, in `main` gemergt.
- **M2** (Backend: Ticket-API), Branch `m2-ticket-api`. Plan:
  1. ✅ Symfony-7.4-Skeleton + Pakete (Doctrine, Serializer, Validator, Uid, Monolog, NelmioApiDoc;
     dev: Maker, PHPUnit, Foundry, Fixtures, DAMA, PHPStan, PHP-CS-Fixer)
  2. ✅ Entity `Ticket` + erste Migration
  3. ✅ Querschnitt: JSON-Logs auf stderr, Fehler als Problem Details (RFC 9457), `/healthz`, `/readyz`
  4. Endpunkte: CRUD, Filter/Sortierung/Paging, `POST /api/tickets/{id}/close`, Optimistic Locking, OpenAPI
  5. Fixtures (Foundry, ca. 200 Tickets)
  6. PHPUnit-API-Tests gegen echte Postgres, PHPStan, PHP-CS-Fixer, `make test`
