# cloudpoc – Roadmap

Ein bewusst langweiliges Ticket-CRUD (Tabelle, Filter, Detailformular) als Vehikel, um
PHP + Angular + Postgres „cloud-native“ zu entwickeln, zu testen und zu betreiben:
Devcontainer mit Wegwerf-DB → mehrere Stagings → Prod mit persistenter, gesicherter DB.
Zielplattformen reichen von einer VM zu Hause bis Azure.

## Entscheidungen

| Thema           | Wahl                                                                    |
|-----------------|-------------------------------------------------------------------------|
| Backend         | Symfony 7.4 LTS, PHP 8.4, Doctrine ORM + Migrations, FrankenPHP         |
| Frontend        | Angular (aktuell), Standalone, Signals, Signal Forms, Angular Material  |
| Datenbank       | PostgreSQL 17                                                           |
| API             | JSON, REST-Stil, RPC-Endpunkte nach Bedarf, Fehler als RFC 9457         |
| CI/CD, Registry | GitHub Actions + GHCR                                                   |
| Deployment      | Option A: Compose (VM) · Option B: Helm/Kubernetes (k3s, AKS)           |
| Container lokal | Podman (Docker-kompatibel)                                              |

## Leitprinzipien

- **12-Factor**: Konfiguration per Env-Vars, Logs als JSON auf stdout, stateless Container.
- **Build once, deploy many**: dasselbe Image (Tag = Git-SHA) läuft in Staging und Prod;
  das Frontend lädt seine Runtime-Config aus `/config.json`.
- **Migrationen als eigener Job** statt beim App-Start, immer rückwärtskompatibel (expand/contract).
- **Same-Origin**: Ein Reverse Proxy leitet `/` ans Frontend und `/api` ans Backend weiter, deshalb ist kein CORS nötig.
- **Health-Endpoints**: `/healthz` (Liveness), `/readyz` (Readiness inkl. DB).
- **Keine echten Prod-Daten in Dev**: nur anonymisierte Dumps.
- **Secrets nie im Repo**.

## Zielstruktur

```
.devcontainer/          Devcontainer (workspace + postgres)
backend/                Symfony
frontend/               Angular
deploy/compose/         Compose-Stack (prod-like, lokal und auf der VM)
deploy/helm/cloudpoc/   Helm-Chart + values je Umgebung
infra/azure/            Terraform
db/                     reset / seed / dump / import / anonymize
.github/workflows/      CI + Deployments
docs/                   Doku je Umgebung, ADRs
Makefile                einheitliche Entry-Points
```

---

## Meilensteine

### M1 – Repo-Skeleton & Devcontainer
- [x] Ordnerstruktur, `Makefile`, `.editorconfig`, `.gitignore`
- [x] `.devcontainer/` mit dem Service `workspace` (PHP 8.4, Composer, Symfony CLI, Node LTS, psql) und dem Service `db` (postgres:17, **ohne Volume**, also eine Wegwerf-DB)
- [x] Podman-Hinweise in `docs/dev.md` (`dev.containers.dockerPath: podman`, Podman-Socket)

**Fertig, wenn:** Der Devcontainer startet und `psql` die DB erreicht.

### M2 – Backend: Ticket-API
- [x] Symfony-Skeleton + Doctrine, Migrations, Serializer, Validator, Monolog (JSON), NelmioApiDoc
- [x] Entity `Ticket`: `id` (UUIDv7), `title`, `description`, `status` (open/in_progress/done),
      `priority` (low/medium/high), `assignee`, `dueDate`, `createdAt`, `updatedAt`, `version`
- [x] Endpunkte:
  - `GET /api/tickets?q=&status=&priority=&assignee=&dueBefore=&sort=&page=&pageSize=`
  - `GET|PUT|DELETE /api/tickets/{id}`, `POST /api/tickets`
  - RPC: `POST /api/tickets/{id}/close`
  - `/healthz`, `/readyz`, OpenAPI unter `/api/doc`
- [x] Problem Details (RFC 9457), Optimistic Locking über `version`
- [x] Fixtures (Foundry, ca. 200 Tickets)
- [x] PHPUnit (API-Tests gegen echte Postgres), PHPStan, PHP-CS-Fixer

**Fertig, wenn:** `make test` grün ist und `curl /api/tickets?status=open` sinnvolle Daten liefert.

### M3 – Frontend: Liste, Filter, Detail
- [x] Angular-App mit Material (ohne Tailwind), Hell/Dunkel-Umschalter (Standard: Systemeinstellung)
- [x] `/tickets` als Tabelle mit Paginator, Sortierung und Filterleiste
      (Filter in den Query-Params, serverseitig ausgewertet)
- [x] `/tickets/new` und `/tickets/:id` als Signal Form mit Speichern, Löschen (mit Bestätigung) und Schließen
- [x] `TicketApiService`, Interceptor für Problem Details (Snackbar)
- [x] Runtime-Config über `/config.json` (z. B. Umgebungs-Banner)
- [x] `proxy.conf.json` für `ng serve`, Unit-Tests

**Fertig, wenn:** CRUD und Filter im Browser gegen das lokale Backend funktionieren.

### M4 – Prod-Images & lokaler Compose-Stack
- [x] Backend-Dockerfile (FrankenPHP, Multi-Stage, `--no-dev`, Opcache, non-root)
      (`.dockerignore`: `backend/fixtures/`, `backend/tests/` gehören nicht ins Image)
- [x] Frontend-Dockerfile (Node-Build → nginx-unprivileged, SPA-Fallback)
- [x] `deploy/compose/compose.yaml` mit Reverse Proxy, frontend, backend, migrate (one-shot) und
      postgres (benanntes Volume)
- [x] DB-Skripte: `make db-reset`, `db-dump`, `db-import FILE=…`, `db/anonymize.sql`
- [x] Playwright-Smoke-Test gegen den Stack (`e2e/`, `make stack-smoke`)

**Fertig, wenn:** `podman compose up` die App bereitstellt und die Daten ein `down`/`up` überleben.

### M5 – CI mit GitHub Actions + GHCR
- [x] GitHub-Remote anlegen
- [x] `ci.yml` für PRs und Pushes: Lint, PHPStan, PHPUnit (Postgres-Service), Angular-Lint/Test/Build,
      Image-Build mit Cache, Trivy-Scan (Job vorhanden, abgeschaltet, siehe M9), Playwright-Smoke
- [x] Push der Images nach GHCR (`:sha`, `:main`)
- [x] Dependabot (monatlich, Minor/Patch gebündelt; PRs blockieren nichts)

**Fertig, wenn:** Ein PR grün durchläuft und die Images in GHCR liegen.

### M6 – VM: Deployment via Compose
Eine VM auf dem Host (statt Homeserver mit Domain), darauf eine einzige Instanz des Stacks.
Staging/Prod-Trennung, TLS und Offsite-Backups stehen in M9.

- [x] VM auf dem Host (Debian 13 + Docker), Anleitung in `docs/vm.md`
- [x] Stack auf der VM: persistentes DB-Volume, `.env` nur auf der VM, `restart: unless-stopped`
- [x] Self-hosted Runner in der VM: eigener unprivilegierter User, nur vom Deploy-Workflow genutzt
      (öffentliches Repo: nie bei `pull_request`, kein Code aus fremden PRs auf der VM)
- [x] Deploy-Workflow: auf Knopfdruck eine beliebige Version (SHA-Tag aus der CI) auf der VM ausrollen,
      Migration als One-Shot wie im Stack. Manuell statt automatisch, weil die VM nur lokal auf dem
      Laptop läuft (automatischer Deploy nach Staging: M9)
- [x] Backup: `make db-dump` auf der VM, Restore-Test mit `make db-import`

**Fertig, wenn:** Jede Version aus der CI per Knopfdruck auf der VM landet, die Daten ein Redeploy
überleben und ein Restore aus einem Dump gelingt.

### M7 – Kubernetes: Helm-Chart & k3s
- [x] Helm-Chart: Deployments, Services, Ingress, ConfigMap (`config.json`), Migrations-Job als
      Hook (`post-install` + `pre-upgrade`), Probes, Resource-Limits, HPA + PDB (prod)
- [x] Chart-Checks ohne Cluster: `make helm-check` (helm lint, kubeconform), Teil von `make test` und CI
- [ ] `values.db.mode`: `cnpg` (CloudNativePG mit 1 Instanz, in Prod mit Backup/PITR; Anzahl als Value,
      Replikas erst bei mehreren Nodes sinnvoll)
      oder `external` (Managed DB)
- [ ] Stagings als Namespaces `staging-<name>`, optional Preview-Envs pro PR
- [ ] Secrets mit SOPS (age)
- [ ] Deploy-Workflows um einen Helm-Pfad erweitern

**Fertig, wenn:** Ein Rolling Update ohne Downtime läuft und die CNPG-Recovery in einen neuen Namespace funktioniert.
Stand: Beim ersten Rolling-Update-Test gab es noch eine 502 und eine 504 (docs/k8s.md, Abschnitt 8).

### M8 – Azure
- [ ] Terraform `infra/azure`: RG, AKS, Postgres Flexible Server (Staging B1ms, Prod HA),
      Key Vault, Log Analytics, Remote-State in Azure Storage
- [ ] GitHub → Azure per OIDC Federated Credentials (keine langlebigen Secrets)
- [ ] External Secrets Operator + Key Vault
- [ ] Prod-Pipeline mit Environment-Approval
- [ ] ADR: Azure Container Apps als günstigere Alternative

**Fertig, wenn:** Dasselbe Helm-Chart mit `db.mode=external` in AKS läuft.

### M9 – Optional / Ausbau
- [ ] AuthN: OIDC (Keycloak/Authentik zu Hause, Entra ID in Azure), entweder per oauth2-proxy am
      Ingress oder in der App (Symfony `AccessTokenHandler` + Angular OIDC-Client)
- [ ] GitOps mit Argo CD
- [ ] Observability: Request-ID, `/metrics`, OpenTelemetry
- [ ] cosign-Signaturen, SBOM
- [ ] Getrennte Umgebungen auf VM/Homeserver: Staging und Prod mit eigener DB, Beförderung desselben Images
      per Tag `v*` mit Freigabe (GitHub-Environment), mehrere benannte Stagings, `make staging-reset`
- [ ] Edge-Proxy (Traefik) mit TLS und Routing per Hostname (braucht eine Domain)
- [ ] Offsite-Backup (restic → S3/B2), Podman Quadlets als Alternative zu Compose
- [ ] Trivy-Scan in CI einschalten (Job `scan` in `ci.yml`, `if: false` entfernen). Stand der ersten Läufe
      (Oktober 2026):
  - Debian/Alpine-Pakete mit Fix (z. B. `pcre2`, `linux-libc-dev`): `apt-get upgrade` bzw. `apk upgrade`
    im Dockerfile. Dabei darauf achten, dass der Build-Cache die Updates nicht einfriert
    (Basis-Images per Digest pinnen und von Dependabot anheben lassen oder regelmäßig ohne Cache bauen).
  - Go-Abhängigkeiten im `frankenphp`-Binary (`kin-openapi`, `grpc`, `x/crypto`): erst mit einem
    FrankenPHP-Release nach v1.12.7 behebbar (upstream `main` ist schon angehoben). Bis dahin
    begründete Ausnahmen in `.trivyignore.yaml` mit Ablaufdatum.

### Durchgehend – Dokumentation
- [ ] `docs/` mit einer Seite je Umgebung (dev, vm, k8s, azure): dev und vm vorhanden
- [ ] ADRs in `docs/adr/` (z. B. Symfony ohne API Platform, FrankenPHP vs. php-fpm/nginx,
      Compose vs. Kubernetes, Auth-Optionen)
