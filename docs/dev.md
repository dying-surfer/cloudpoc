# Lokale Entwicklung (Devcontainer)

Entwickelt wird in einem Devcontainer mit zwei Services:

| Service     | Inhalt                                                              |
|-------------|---------------------------------------------------------------------|
| `workspace` | PHP 8.4, Composer, Symfony CLI, Node LTS, psql – hier arbeitest du  |
| `db`        | PostgreSQL 17 als **Wegwerf-DB**: Daten liegen im RAM (tmpfs)       |

Die DB ist nach jedem Neustart des Containers leer. Echte Daten gehören nicht hierher,
höchstens anonymisierte Dumps: `make dev-db-import FILE=db/dumps/cloudpoc-anon-….dump`
(erzeugt mit `make db-dump-anon` aus dem Stack).

## Voraussetzungen (Podman statt Docker)

Wir nutzen **rootless Podman**. VS Code und die Devcontainer-CLI erwarten eine Docker-API.
Die stellt Podman über einen Socket bereit.

Beispiel Bluefin / Fedora Atomic. Das System ist unveränderlich, deshalb kommen CLI-Tools über
Homebrew. Podman ist dort schon vorinstalliert.

```bash
# 1. Podman-Socket (Docker-kompatible API) für den eigenen User aktivieren
systemctl --user enable --now podman.socket

# 2. Compose und Devcontainer-CLI installieren
brew install docker-compose devcontainer

# 3. Docker-Tools auf den Podman-Socket zeigen lassen (gilt für die ganze Sitzung)
mkdir -p ~/.config/environment.d
echo 'DOCKER_HOST=unix://${XDG_RUNTIME_DIR}/podman/podman.sock' > ~/.config/environment.d/podman.conf

# 4. VS-Code-Extension
code --install-extension ms-vscode-remote.remote-containers
```

Danach **ab- und wieder anmelden**. `environment.d` wird nur beim Login gelesen.

Prüfen:

```bash
echo $DOCKER_HOST          # unix:///run/user/1000/podman/podman.sock
docker-compose version
podman compose version
devcontainer --version
```

Auf anderen Distributionen installierst du `podman`, `docker-compose` und den Devcontainer-CLI
(`npm i -g @devcontainers/cli`) über den jeweiligen Paketmanager. Die Schritte 1, 3 und 4 sind gleich.

### VS-Code-Einstellungen

In den **User**-Settings (`settings.json`). Workspace-Settings gehen hier nicht, weil es
maschinenspezifische Einstellungen sind:

```json
{
  "dev.containers.dockerPath": "podman",
  "dev.containers.dockerComposePath": "/home/linuxbrew/.linuxbrew/bin/docker-compose"
}
```

`docker-compose` mit vollem Pfad: Aus dem Dock gestartet erbt VS Code den PATH von systemd, und darin
fehlt Homebrew (das trägt nur `/etc/profile.d/brew.sh` in Login-Shells ein), siehe *Fehlersuche*.

## Starten

**In VS Code:** Ordner öffnen → Befehlspalette → *Dev Containers: Reopen in Container*.
Beim ersten Mal wird das Image gebaut, das dauert ein paar Minuten.

**Im Terminal** (ohne VS Code):

```bash
make dev-up      # bauen und starten
make dev-shell   # Shell im workspace
make dev-psql    # psql gegen die Wegwerf-DB
make dev-down    # alles stoppen und entfernen
```

Im workspace ist `psql` vorkonfiguriert (`PGHOST`, `PGUSER`, … sind gesetzt), ein nacktes
`psql` reicht also. Für Symfony ist `DATABASE_URL` gesetzt.

## Backend starten

Im Terminal des Devcontainers:

```bash
cd backend
php bin/console doctrine:migrations:migrate -n   # Schema anlegen (die DB ist nach jedem Neustart leer)
php bin/console doctrine:fixtures:load -n       # 200 Demo-Tickets (löscht vorher alle Daten)
symfony server:start -d --no-tls --port=8000 --allow-all-ip
```

VS Code leitet Port 8000 automatisch an den Host weiter (Tab *Ports*). Dann im Browser:

- <http://localhost:8000/api/doc>: Swagger UI zum Ausprobieren
- <http://localhost:8000/healthz>, <http://localhost:8000/readyz>: Health-Probes

Logs: `symfony server:log` (folgt dem Log, Abbruch mit Strg+C). Stoppen: `symfony server:stop`.

Fehler unter `/api` kommen als Problem Details (RFC 9457) mit `Content-Type: application/problem+json`.

## Frontend starten

Das Backend muss laufen (siehe oben). Dann in einem zweiten Terminal des Devcontainers:

```bash
cd frontend
npm ci        # nur beim ersten Mal bzw. nach Änderungen am package-lock.json
npm start     # ng serve auf Port 4200, lädt bei Änderungen automatisch neu
```

Im Browser: <http://localhost:4200> (VS Code leitet den Port weiter wie beim Backend).

`ng serve` leitet alles unter `/api` per `proxy.conf.json` an das Backend auf Port 8000 weiter.
Für den Browser kommen App und API so vom selben Origin, CORS braucht es nicht. Später übernimmt
das der Reverse Proxy (M4).

**Runtime-Config:** Beim Start lädt die App `/config.json` (lokal aus `frontend/public/`), erst
danach rendert sie. Darin steht z. B. der Text des Umgebungs-Banners. Weil die Datei nicht in
den Build eingebaut wird, läuft dasselbe Image später in jeder Umgebung, nur die `config.json`
wird ausgetauscht. Fehlt sie, startet die App absichtlich nicht.

**UI:** Angular Material (Material 3), Schriften selbst gehostet aus npm-Paketen statt vom
Google-CDN. Hell/Dunkel folgt standardmäßig dem System; die Wahl im Menü oben rechts landet im
`localStorage`. Warum nicht PrimeNG: `docs/adr/0001-angular-material-statt-primeng.md`.

**Ticketliste (`/tickets`):** Filter, Sortierung und Seite stehen nur in der URL (Query-Params).
Der Router schreibt sie in Signal-Inputs der Komponente (`withComponentInputBinding`), daraus
lädt eine `rxResource` die Seite. Bedienelemente ändern nur die URL; so lassen sich Ansichten
verlinken, und Zurück/Vor im Browser funktioniert. Ungültige Werte in der URL werden ignoriert.
API-Fehler zeigt ein Interceptor als Snackbar (`core/problem-details.ts`).

**Ticketformular (`/tickets/new`, `/tickets/:id`):** Signal Form (`@angular/forms/signals`);
`[formField]` funktioniert auch mit `mat-select`, weil Signal Forms klassische
`ControlValueAccessor`-Controls über eine Brücke anbinden. Gespeichert wird mit der zuletzt
geladenen `version`. Bei 409 zeigt die Seite einen Hinweis mit „Neu laden“, bei 422 erscheinen
die Violations des Backends am jeweiligen Feld. Schließen ist gesperrt, solange es ungespeicherte
Änderungen gibt, Löschen fragt vorher nach.

## Tests und Checks

```bash
make test             # alles; geht auf dem Host und im Devcontainer
cd backend && composer check   # Backend direkt: cs + phpstan + test
composer cs-fix       # Code-Style automatisch korrigieren
cd frontend && npm run check   # Frontend direkt: prettier + eslint + vitest + build
npm run format        # Formatierung automatisch korrigieren (Prettier)
npm test              # Vitest im Watch-Modus, während man entwickelt
```

- Die API-Tests laufen gegen eine eigene Postgres-DB **`app_test`** (Doctrine hängt im Test-Env
  `_test` an den DB-Namen). Foundry baut sie bei jedem Testlauf frisch auf, und zwar über die
  echten Migrationen. Fehlt also eine Migration, schlagen die Tests fehl.
- Jeder Test läuft in einer Transaktion, die DAMA danach zurückrollt: Tests sehen sich gegenseitig
  nicht, und die Test-DB bleibt leer. Die Dev-DB `app` wird nie angefasst.
- Testdaten erzeugen die Tests selbst mit `TicketFactory`, statt auf die Fixtures zu bauen.
  So steht im Test, wovon er abhängt.

### Smoke-Tests gegen den Stack (Playwright)

`e2e/` enthält wenige Playwright-Tests, die nur das Zusammenspiel prüfen: Proxy-Routing,
Health-Endpoints, Banner aus `config.json`, ein Ticket anlegen, finden und löschen.

```bash
make stack-up && make stack-smoke   # auf dem Host; Bericht danach in e2e/playwright-report/
make e2e-check                      # überall: Prettier, TypeScript, Testliste (Teil von make test)
```

- `stack-smoke` startet das offizielle Image `mcr.microsoft.com/playwright` im Compose-Netz
  (`cloudpoc_default`) mit `BASE_URL=http://proxy:8080`. Browser und Systembibliotheken bringt das
  Image mit; im Devcontainer fehlen sie (Chromium startet dort nicht, `libglib-2.0.so.0` fehlt).
- Die Image-Version kommt aus `e2e/package.json`. `@playwright/test` ist dort exakt gepinnt, weil
  Bibliothek und Browser im Image zusammenpassen müssen.
- Der Test schreibt in die persistente Stack-DB. Er legt ein Ticket mit eindeutigem Titel an und
  räumt es auch dann wieder ab, wenn er scheitert.

## Claude Code im Devcontainer

Claude Code ist über das Feature `ghcr.io/anthropics/devcontainer-features/claude-code` im Image
installiert. Im VS-Code-Terminal des Containers `claude` starten und beim ersten Mal anmelden.

- Claude sieht im Container nur das Repo, nicht dein Home-Verzeichnis auf dem Host.
- Login und Einstellungen liegen im benannten Volume `cloudpoc-dev_claude-config`
  (`CLAUDE_CONFIG_DIR=/home/dev/.claude`). Sie überleben *Rebuild Container* und `make dev-down`.
  Komplett abmelden: `podman volume rm cloudpoc-dev_claude-config` (bei gestopptem Container).
- Projektregeln für Claude stehen in `CLAUDE.md`.
- Im Container gibt es kein Podman. Container und Images baust du weiterhin auf dem Host.

## Warum es so gebaut ist

- **`userns_mode: keep-id:uid=1000,gid=1000`:** Rootless Podman bildet deinen Host-User normalerweise
  auf root im Container ab. `keep-id` bildet ihn stattdessen auf den Container-User `dev` (UID 1000)
  ab, und das unabhängig davon, welche UID du auf dem Host hast. So gehören Dateien, die im
  Container entstehen (`vendor/`, `node_modules/`), auf dem Host dir.
- **`:z` am Repo-Mount:** setzt das SELinux-Label, damit der Container das Repo lesen und
  schreiben darf (Fedora/Bluefin).
- **`tmpfs` statt Volume für die DB:** Das Postgres-Image deklariert ein `VOLUME`. Ohne
  `tmpfs` würde Compose ein anonymes Volume anlegen, das Neustarts überlebt.

## Fehlersuche

| Symptom                                         | Ursache / Lösung                                                   |
|-------------------------------------------------|--------------------------------------------------------------------|
| `echo $DOCKER_HOST` ist leer                    | Nach dem Anlegen von `environment.d/podman.conf` nicht neu angemeldet |
| `Cannot connect to the Docker daemon`           | Socket läuft nicht: `systemctl --user status podman.socket`         |
| `Permission denied` auf Dateien im Container    | SELinux-Label fehlt (`:z`) oder UID-Mapping (`keep-id`) greift nicht |
| VS Code sucht `docker`                          | User-Setting `dev.containers.dockerPath: podman` fehlt              |
| `podman build … updateUID.Dockerfile` schlägt fehl | Die CLI sucht `localhost/<image>`, Compose taggt aber `docker.io/library/<image>`. Deshalb ist in `devcontainer.json` `updateRemoteUserUID: false` gesetzt; die UID-Anpassung übernimmt `keep-id` |
| `devcontainer exec psql -c …`: „Unknown argument: c“ | Die CLI wertet Optionen mit `-` auch für den Befehl im Container aus. Stattdessen `podman compose -f .devcontainer/compose.yaml exec workspace …` nutzen (so machen es auch die `make`-Targets) |
| `perl: warning: Setting locale failed`          | Die Host-Locale fehlt im Image. Erzeugt werden `de_DE.UTF-8` und `en_US.UTF-8` (Dockerfile); weitere bei Bedarf dort in `locale.gen` ergänzen |
| npm: „packages have install scripts not yet covered by allowScripts“ | npm 11 führt Install-Skripte nur noch nach Freigabe aus. Entschieden wird pro Paket in `allowScripts` (`frontend/package.json`); die Build-Tools dort laufen mit ihren mitgelieferten Binaries, ihre Skripte sind abgelehnt. Bei einem neuen Paket: `npm install-scripts ls`, dann `approve` oder `deny` |
| API: `relation "ticket" does not exist` (500)   | Die Wegwerf-DB ist nach einem Neustart des `db`-Containers leer. Schema und Demo-Daten neu einspielen: `doctrine:migrations:migrate -n` und `doctrine:fixtures:load -n` (siehe *Backend starten*) |
| `npm run check`: Prettier meckert über `angular.json` | Die Angular CLI schreibt die Datei in ihrem eigenen Format (z. B. nach der Analytics-Frage). `npm run format` behebt es |
| Vitest: „Test timed out“ in Komponententests mit `HttpTestingController` | `fixture.whenStable()` wartet auch auf offene HTTP-Requests (eine `resource` zählt als laufende Aufgabe). Vor `expectOne()` deshalb nur `TestBed.tick()` aufrufen, `whenStable()` erst nach `flush()` |
| Prod-Build mit `php -S` getestet: `/readyz` meldet die DB als „unavailable“, obwohl `DATABASE_URL` gesetzt ist | `composer dump-env prod` schreibt die `.env`-Werte (mit `!ChangeMe!`) nach `.env.local.php`. Echte Env-Vars haben nur Vorrang, wenn PHP sie in `$_SERVER`/`$_ENV` ablegt. `php -S` tut das mit `variables_order=GPCS` nicht, FrankenPHP im Prod-Image schon. Für `php -S`: `-d variables_order=EGPCS` |
| `curl localhost:<port>` auf einen Container: „Recv failure: Verbindung zurückgesetzt“, mit `127.0.0.1` geht es | `localhost` wird zu `::1` (IPv6) aufgelöst, und rootless Podman (pasta) reicht IPv6 als IPv6 in den Container weiter. Der Dienst darin lauscht nur auf IPv4. Bei nginx zusätzlich `listen [::]:8080;` (siehe `frontend/docker/nginx.conf`) |
| `podman compose …`: „failed to connect to the docker API at unix:///run/user/1000/podman/podman.sock … no such file or directory“ | Die Socket-Datei fehlt, obwohl `podman.socket` aktiviert ist (Ursache unklar, trat in M4 einmal auf). `systemctl --user restart podman.socket` legt sie neu an. Zum Nachsehen: `systemctl --user status podman.socket`, `journalctl --user -u podman.socket -n 20` |
| VS Code: „spawn docker-compose ENOENT“ beim Öffnen des Devcontainers; `podman compose`: „looking up compose provider failed“ | Homebrew fehlt im PATH. VS Code aus dem Dock bekommt den PATH von systemd (`systemctl --user show-environment`), ohne `/home/linuxbrew/.linuxbrew/bin`. Fiel erst nach `make dev-down` auf: Existiert der Container schon, startet VS Code ihn per `podman`, nur zum Neuanlegen braucht es Compose. Lösung: `dockerComposePath` mit vollem Pfad (siehe *VS-Code-Einstellungen*). Die `make`-Targets deshalb im normalen Terminal ausführen (ein `make stack-down` scheiterte in M4 vermutlich im Terminal eines aus dem Dock gestarteten VS Code) |
| Stack: Proxy startet nicht, „port 8000 already in use“ | 8000 ist der Port des Dev-Backends, VS Code leitet ihn aus dem Devcontainer an den Host weiter. Der Stack nutzt deshalb 8088 (`HTTP_PORT` in `deploy/compose/.env`). Wer den Port belegt: `ss -ltnp \| grep :8000` |
| Image aus CI enthält `tests/`, `fixtures/` oder `.env.test`, lokal nicht | Docker BuildKit (CI, `docker/build-push-action`) liest nur `.dockerignore`, Podman auch `.containerignore`. Die Ignore-Dateien heißen deshalb `.dockerignore` (in M5 umbenannt), dann gelten sie für beide |
