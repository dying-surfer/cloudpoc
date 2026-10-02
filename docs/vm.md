# VM: Deployment via Compose

Eine Debian-VM auf dem Host, darauf **eine** Instanz des Stacks aus `deploy/compose/`.
Ausgerollt wird automatisch: Nach grüner CI auf `main` holt ein **Self-hosted Runner** in der VM
die gerade gebauten Images (SHA-Tag) aus GHCR und startet den Stack damit neu.

```
GitHub ── Job "deploy" ──▶ Runner in der VM (baut die Verbindung selbst auf, von innen nach außen)
                              │ docker compose pull/up mit den SHA-Images
                              ▼
                         proxy :8080 → frontend, backend → db (Volume, bleibt bei Redeploys)
```

Warum ein Runner in der VM statt SSH aus GitHub: Die VM ist aus dem Internet nicht erreichbar.
Der Runner fragt GitHub von sich aus nach Jobs, dafür muss nichts nach innen offen sein.

## 1. VM anlegen

Empfehlung: **virt-manager** (libvirt, Verbindung `QEMU/KVM` = `qemu:///system`). Die VM hängt dann
im NAT-Netz `default` (192.168.122.x) und ist vom Host aus per IP erreichbar (SSH, Browser).
GNOME Boxes geht auch, nutzt aber User-Networking: Dann ist die VM vom Host aus nicht direkt
erreichbar, und man braucht Port-Weiterleitungen.

- Image: Debian 13 „trixie“, netinst-ISO von debian.org
- 2 vCPU, 4 GB RAM, 20 GB Disk
- Bei der Installation: **kein Desktop**, nur „SSH server“ und „Standard-Systemwerkzeuge“.
  Einen normalen User für dich anlegen (im Folgenden `admin`), root-Passwort leer lassen,
  dann bekommt `admin` `sudo`.

Nach dem ersten Start die IP herausfinden (`ip -4 addr` in der VM-Konsole) und vom Host aus testen:

```bash
ssh admin@192.168.122.x
```

## 2. Docker installieren

Aus dem offiziellen Docker-Repo (Debians eigenes `docker.io` ist älter und hat kein Compose v2):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git make libicu76
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo docker run --rm hello-world   # Test
docker compose version             # Compose v2
```

`git` und `make` braucht der Runner: Er checkt das Repo aus und ruft die `make`-Targets auf.
`libicu76` braucht der Runner selbst (er ist ein .NET-Programm), ohne sie bricht `config.sh` ab.

## 3. User für den Runner

Der Runner läuft als eigener User `runner`, nicht als `admin` und nicht als root:

```bash
sudo useradd --create-home --shell /bin/bash runner
sudo usermod -aG docker runner
```

**Achtung:** Die Gruppe `docker` darf den Docker-Daemon steuern und ist damit faktisch root auf
dieser VM. Das nehmen wir bewusst in Kauf: Die VM gehört nur dem PoC, und auf dem Runner läuft
nur unser Deploy-Workflow (siehe Abschnitt 5). Strenger wäre Rootless Docker, das ist hier aber
den Aufwand nicht wert.

## 4. Secrets der Instanz

Die `.env` des Stacks liegt **nur auf der VM**, außerhalb des Checkouts (den räumt der Runner bei
jedem Lauf neu auf). Der Deploy-Workflow nimmt sie von dort.

```bash
sudo install -d -o runner -g runner -m 700 /srv/cloudpoc
sudo -u runner sh -c 'umask 077 && cat > /srv/cloudpoc/.env' <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_SECRET=$(openssl rand -hex 32)
HTTP_PORT=8080
EOF
sudo cat /srv/cloudpoc/.env   # prüfen
```

Das Passwort gilt ab dem ersten Start des Stacks: Postgres legt den User beim Initialisieren des
leeren Volumes an. Später geändert, passt es nicht mehr zur DB.

## 5. Runner registrieren

Auf GitHub: Repo → *Settings → Actions → Runners → New self-hosted runner*, Linux, x64.
Die Seite zeigt zwei Blöcke: *Download* (Version und Prüfsumme ändern sich mit jedem Release, darum
stehen sie hier nicht) und *Configure* mit einem Token, der eine Stunde gilt.

**a) Als `runner` anmelden.** Alles bis Schritt c) läuft als `runner`, nicht als `admin`, sonst
gehören die Dateien dem falschen User:

```bash
sudo -iu runner
whoami                                  # muss "runner" sagen, Prompt: runner@debian
mkdir -p ~/actions-runner && cd ~/actions-runner
```

**b) Herunterladen.** Aus dem Block *Download* nur die drei Zeilen ab `curl -o actions-runner-…`
kopieren (`curl`, `echo "<prüfsumme>  …" | shasum -a 256 -c`, `tar xzf …`); `mkdir`/`cd` sind
schon erledigt. Fehlt `shasum`, statt dessen `sha256sum -c` nehmen, die Eingabe ist dieselbe.
Danach liegen u. a. `config.sh`, `run.sh` und `bin/` im Verzeichnis, aber noch **kein** `svc.sh`.

**c) Registrieren.** Den Befehl aus *Configure* **nicht** übernehmen, sondern diesen mit dem Token
von dort (setzt Name und Label ohne Rückfragen):

```bash
./config.sh --url https://github.com/dying-surfer/cloudpoc --token <TOKEN> \
  --name cloudpoc-vm --labels vm --unattended
```

Erfolgreich, wenn die Ausgabe mit `√ Settings Saved.` endet. Erst jetzt entsteht `svc.sh`:

```bash
ls svc.sh .runner .credentials          # alle drei müssen da sein
rm actions-runner-linux-x64-*.tar.gz    # Archiv wird nicht mehr gebraucht
exit                                    # zurück zu admin
```

`./run.sh` **nicht** starten: Das wäre der Runner im Vordergrund, wir richten ihn als Dienst ein.

**d) Als systemd-Dienst einrichten** (als `admin`), damit er nach einem Neustart der VM wieder läuft.
`svc.sh` braucht root und muss im Runner-Verzeichnis aufgerufen werden; `runner` am Ende ist der
User, unter dem der Dienst läuft:

```bash
sudo bash -c 'cd /home/runner/actions-runner && ./svc.sh install runner && ./svc.sh start'
sudo systemctl status 'actions.runner.*'     # active (running)
```

Auf GitHub erscheint der Runner danach als *Idle* mit den Labels `self-hosted`, `Linux`, `X64`, `vm`.

Stolpersteine:

- **`svc.sh` fehlt:** `config.sh` ist nicht (erfolgreich) gelaufen. Als `runner` erneut ausführen
  (Schritt c), ggf. mit neuem Token, wenn die Stunde um ist.
- **„Libicu's dependencies is missing for Dotnet Core“:** `libicu76` fehlt (siehe Abschnitt 2).
  Als `admin` `sudo apt-get install -y libicu76`, dann Schritt c) wiederholen. Das vorgeschlagene
  `./bin/installdependencies.sh` geht auch, braucht aber root, und `runner` hat kein `sudo`.
- **`config.sh` meldet „Must not run with sudo“ oder Permission denied:** falscher User,
  siehe Schritt a).
- **„A runner exists with the same name“:** Runner unter *Settings → Actions → Runners* löschen
  oder `--replace` an `config.sh` anhängen.

### Absicherung (öffentliches Repo)

Jeder kann einen PR öffnen und darin Workflows ändern. Damit kein fremder Code auf der VM läuft:

- Nur der Deploy-Workflow nutzt `runs-on: [self-hosted, vm]`, und er startet **nie** bei
  `pull_request`, nur nach CI auf `main`. Ändert ein PR einen Workflow so, dass er den Runner
  nutzen würde, läuft der Lauf erst nach deiner Freigabe (nächster Punkt).
- *Settings → Actions → General → Approval for running fork pull request workflows from
  contributors*: **Require approval for all external contributors**.
- Fork-PRs nie freigeben, ohne vorher die Änderungen an `.github/` gelesen zu haben.

## 6. Prüfen

Ist der erste Deploy durchgelaufen (in der VM als `admin`):

```bash
sudo docker ps                                  # proxy, frontend, backend, db laufen; migrate ist beendet
curl -s http://localhost:8080/readyz            # {"status":"ok",…}
```

Vom Host aus im Browser: `http://192.168.122.x:8080`.
