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
  (VS Code: *Dev Containers: Rebuild Container*). Images bauen und Stack testen: siehe M4 unten.
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
  - Migrationen **expand/contract**: Jede Migration muss zur vorherigen Code-Version passen (Rolling Update,
    alter Code läuft kurz gegen das neue Schema). Kein Umbenennen/Löschen von Spalten und kein `NOT NULL` ohne
    Default in einem Schritt; Regeln und Beispiel in `docs/k8s.md` (Abschnitt 8).
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
- **M4** (Prod-Images & Compose-Stack): fertig, in `main` gemergt. Entscheidung: Claude schreibt
  Dockerfiles und `make`-Targets, der **User baut und testet auf dem Host** und meldet die Ausgabe zurück
  (kein Podman-Socket im Devcontainer, damit Claude weiterhin nur das Repo sieht). Vorher so viel wie
  möglich ohne Podman prüfen (z. B. Build-Schritte in einer Kopie im Scratchpad nachspielen).
  - Backend-Image: `backend/Dockerfile` (FrankenPHP, Multi-Stage, User `app`, Port 8080), `make backend-image`.
  - Frontend-Image: `frontend/Dockerfile` (Node-Build → nginx-unprivileged, Port 8080), `make frontend-image`.
    `config.json` ist nicht im Image, sie wird pro Umgebung nach `/usr/share/nginx/html/config.json` gemountet.
  - DB-Werkzeuge: `make db-reset`, `db-dump`, `db-import FILE=…` (Stack), `db-dump-anon` (Kopie im db-Container
    anonymisieren, nur der Dump verlässt den Container), `dev-db-import` (nur `*-anon-*`). `db/anonymize.sql` ordnet
    jede Spalte ein und bricht bei unbekannten ab: Neue Spalten dort eintragen.
  - Stack: `deploy/compose/` (proxy = nginx, frontend, backend, migrate als One-Shot, db mit Volume), Port 8088,
    Secrets in `deploy/compose/.env` (nicht im Repo, Vorlage `.env.example`). `make images`, `make stack-up` usw.
    Reverse Proxy: nginx (Kriterium des Users: production-ready und verbreitet); Edge-Proxy mit TLS voraussichtlich Traefik (M9).
  - Smoke-Tests: `e2e/` (Playwright, nur Zusammenspiel prüfen). `make stack-smoke` (Host) läuft im Playwright-Image
    im Compose-Netz gegen `http://proxy:8080`; `make e2e-check` statisch, Teil von `make test`. Im Devcontainer
    startet Chromium nicht (Systembibliotheken fehlen). `@playwright/test` exakt pinnen, der Image-Tag folgt daraus.
- **M5** (CI mit GitHub Actions + GHCR): fertig, in `main` gemergt (per PR auf GitHub). Remote: `dying-surfer/cloudpoc`.
  Pushen, PRs und Mergen macht der User auf dem Host (im Devcontainer kein `gh`, kein SSH-Key).
  - `.github/workflows/ci.yml`: Jobs `backend` (mit Postgres-Service), `frontend`, `e2e-check` → `images`
    (Buildx, GHA-Cache, Push nach `ghcr.io/dying-surfer/cloudpoc-{backend,frontend}`) → `smoke` und `scan`.
  - Image-Tags: voller Commit-SHA (bei PRs der Merge-Commit), auf `main` zusätzlich `:main`. Pakete sind privat.
  - `smoke` nutzt dieselben `make`-Targets wie der Host, mit `CONTAINER=docker` (Standard `podman`).
  - Ignore-Dateien heißen `.dockerignore` (BuildKit liest kein `.containerignore`).
  - Trivy-Job `scan` ist per `if: false` abgeschaltet (Funde in den Basis-Images, siehe ROADMAP M9).
    Fremde Actions mit Sicherheitsvorgeschichte auf Commit-SHA pinnen (`trivy-action`).
  - Dependabot monatlich, Minor/Patch gebündelt, Majors einzeln; PRs sind optional.
  - Workflows prüfen: `npx prettier --check` und `actionlint` (Binary ins Scratchpad laden).
- **M6** (VM: Deployment via Compose): fertig, in `main` gemergt. Anleitung: `docs/vm.md`.
  - Debian-VM mit Docker auf dem Host, Stack mit `restart: unless-stopped`, `.env` nur auf der VM
    (`/srv/cloudpoc/.env`, `ENV_FILE`), Container-Logs per `journald`.
  - Self-hosted Runner (User `runner`, Label `vm`) nur für `.github/workflows/deploy.yml`:
    manuell per `workflow_dispatch`, Version (SHA, Branch, Tag) wird auf den SHA-Tag aufgelöst, dann `make deploy`.
    Nie `pull_request` auf dem Self-hosted Runner (öffentliches Repo).
  - Backup auf der VM: `make db-dump DUMP_DIR=/srv/cloudpoc/dumps` (nicht im Checkout, den räumt der nächste Deploy);
    für `db-import` `BACKEND_IMAGE` auf das laufende Image setzen.
- **M7** (Kubernetes: Helm-Chart & k3s): fertig, in `main` gemergt (per PR auf GitHub). Anleitung: `docs/k8s.md`.
  - Namespaces heißen `<app>-<umgebung>` (`cloudpoc-staging`): Der Cluster ist für mehrere Apps gedacht. Ordner
    unter `deploy/secrets/` und Werte-Datei unter `deploy/helm/values/` tragen denselben Namen.
  - k3s-VM `192.168.122.51` (Single-Node, Traefik als Ingress), CNPG-Operator 1.30.1 (Chart 0.29.1).
    `kubectl`/`helm` nur auf dem Host (kubeconfig per `KUBECONFIG`), nie im Devcontainer.
  - Chart `deploy/helm/cloudpoc/`: `image.tag` Pflicht (Commit-SHA), `db.mode` `cnpg` | `external`,
    Migrationen als Hook-Job `post-install,pre-upgrade`, `values-prod.yaml` (HPA, PDB).
    Secrets `ghcr-pull` und `cloudpoc-backend` (APP_SECRET) per SOPS (age) in `deploy/secrets/<ns>/`, anwenden mit
    `make k8s-secrets NS=cloudpoc-staging` (Host). Privater Schlüssel nur auf dem Host, nie im Devcontainer. Das DB-Passwort
    erzeugt der CNPG-Operator (Secret `cloudpoc-db-app`), nicht im Repo.
  - Prüfen: `make helm-check` (`deploy/helm/check.sh`, alle Werte-Varianten). Neue Varianten dort eintragen.
    `make secrets-check` prüft, dass alles unter `deploy/secrets/` verschlüsselt ist.
  - Upgrades von Hand mit `--reset-then-reuse-values`, nie `--reuse-values` (übernimmt neue Chart-Defaults nicht).
  - Deploy: `make k8s-deploy NS=cloudpoc-staging TAG=<voller SHA>` (Host): `k8s-secrets`, dann `helm upgrade --install`
    mit `deploy/helm/values/<NS>.yaml`, ohne reuse (alle Werte aus dem Repo). `TAG` hat im Makefile den
    Default `local` (Image-Builds), das Target verlangt deshalb 40 Hex-Zeichen. Neue Namespaces: Werte-Datei anlegen.
  - Deploy-Workflow `.github/workflows/deploy-k8s.yml` (`workflow_dispatch`, wie M6): Self-hosted Runner
    `cloudpoc-k3s` in der k3s-VM (User `runner`, Label `k3s`, k3s-API bleibt von außen zu), ruft `make k8s-deploy`.
    Zugänge nur auf der VM: kubeconfig des ServiceAccount `deployer` (`deploy/k3s/deployer-cloudpoc-staging.yaml`,
    Rechte nur im Namespace) unter `/home/runner/.kube/cloudpoc-staging.yaml`, eigener age-Schlüssel als zweiter
    Empfänger in `.sops.yaml` (nach Änderungen dort: `sops updatekeys`). Erster Lauf erfolgreich (Oktober 2026).
  - Ein Zwischenstand von M7 kam vorab per PR #15 in `main` (nötig, damit der Workflow startbar ist und Images existieren).
  - `make`-Checks: `USE_DEVCONTAINER` im Makefile (podman vorhanden und nicht `CI`) entscheidet über exec in den
    Devcontainer; GitHub-Runner haben podman, aber keinen Devcontainer.
  - Rolling Update: `deploy/k3s/rollout-test.sh` (Host, Admin-kubeconfig) misst unter Last; sechs Läufe ohne Fehler.
    Die 502/504 aus einem früheren Handtest traten nicht wieder auf, Ursache ungeklärt (docs/k8s.md, Abschnitt 8).
  - Backup/PITR (docs/k8s.md, Abschnitt 12): Barman-Cloud-Plugin 0.15.1 (Chart 0.8.1) in `cnpg-system`, dafür
    cert-manager v1.21.2; das eingebaute `barmanObjectStore` ist abgekündigt. S3-Speicher: RustFS im Namespace
    `rustfs` (`deploy/k3s/rustfs.yaml`, nur Test-Ersatz, Backups liegen auf derselben VM), der Bucket
    `cloudpoc-backups` entsteht per Job (das Plugin legt ihn nicht an). Root-Zugang in `deploy/secrets/rustfs/`
    (nur Schlüssel des Users), je Namespace das Secret `cloudpoc-s3` mit denselben Werten.
  - Chart: `db.cnpg.backup` (ObjectStore, `spec.plugins`, ScheduledBackup; Pfad `s3://<bucket>/<namespace>/`) und
    `db.cnpg.recovery` (neuer Cluster aus dem Archiv von `sourceNamespace`, optional `targetTime`; nur beim ersten
    Install, nie in den Quell-Namespace). In `cloudpoc-staging` ist Backup an.
  - Recovery-Test: `deploy/k3s/recovery-test.sh` (Host, Admin-kubeconfig) stellt nach `cloudpoc-restore` wieder her,
    erster Lauf erfolgreich (Oktober 2026). Danach `kubectl delete namespace cloudpoc-restore`.
  - Stolperstein: Wird Backup bei einem bestehenden Cluster eingeschaltet, scheitert das sofortige Backup
    (`immediate: true`), dann eines von Hand auslösen. Ob es bei einem neuen Cluster klappt, ist ungetestet.
  - Verschoben nach M9: Stagings als weitere Namespaces (`cloudpoc-staging-<name>`).
