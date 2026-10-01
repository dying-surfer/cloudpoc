# Lokale Entwicklung (Devcontainer)

Entwickelt wird in einem Devcontainer mit zwei Services:

| Service     | Inhalt                                                              |
|-------------|---------------------------------------------------------------------|
| `workspace` | PHP 8.4, Composer, Symfony CLI, Node LTS, psql – hier arbeitest du  |
| `db`        | PostgreSQL 17 als **Wegwerf-DB**: Daten liegen im RAM (tmpfs)       |

Die DB ist nach jedem Neustart des Containers leer. Echte Daten gehören nicht hierher,
höchstens anonymisierte Dumps (ab M4: `make db-import`).

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
  "dev.containers.dockerComposePath": "docker-compose"
}
```

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

## Warum es so gebaut ist

- **`userns_mode: keep-id`:** Rootless Podman bildet deinen Host-User normalerweise auf root im
  Container ab. `keep-id` bildet stattdessen Host-UID 1000 auf den Container-User `dev`
  (UID 1000) ab. So gehören Dateien, die im Container entstehen (`vendor/`, `node_modules/`),
  auf dem Host dir.
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
