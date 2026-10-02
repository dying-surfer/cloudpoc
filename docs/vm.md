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
sudo apt-get update && sudo apt-get install -y ca-certificates curl git make
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
Die Seite zeigt Download-Befehle und einen Token (gilt eine Stunde). Als `runner` ausführen:

```bash
sudo -iu runner
mkdir actions-runner && cd actions-runner
# Download- und Prüfsummen-Befehle von der GitHub-Seite hier einfügen (curl … && tar xzf …)
./config.sh --url https://github.com/dying-surfer/cloudpoc --token <TOKEN> \
  --name cloudpoc-vm --labels vm --unattended
exit
```

Als systemd-Dienst einrichten, damit er nach einem Neustart der VM wieder läuft (als `admin`):

```bash
cd /home/runner/actions-runner
sudo ./svc.sh install runner
sudo ./svc.sh start
sudo ./svc.sh status
```

Auf GitHub erscheint der Runner danach als *Idle* mit den Labels `self-hosted`, `Linux`, `X64`, `vm`.

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
