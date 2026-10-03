# Kubernetes: k3s auf einer VM

Eine zweite Debian-VM auf dem Host, darauf **k3s** als Single-Node-Cluster. Die M6-VM mit dem
Compose-Stack bleibt davon unberührt. Gesteuert wird der Cluster vom Host aus mit `kubectl`
(später auch `helm`), über die Kubernetes-API auf Port 6443 der VM.

```
Host (kubectl, helm) ──6443──▶ VM "k3s": API-Server
Browser ──────────────80─────▶ VM "k3s": Traefik (Ingress) → Pods
```

## Was k3s ist

k3s ist eine vollständige, zertifizierte Kubernetes-Distribution (von Rancher/SUSE, CNCF-Projekt)
in **einem** Binary. Die Kubernetes-API ist dieselbe wie bei AKS oder jedem anderen Cluster, deshalb
läuft unser Helm-Chart später ohne Änderung auch in Azure. Schlank wird k3s dadurch, dass es
alle Bestandteile in einen Prozess packt und statt etcd standardmäßig SQLite als Datenspeicher
nutzt (bei einem Node reicht das).

Ohne weiteres Zutun bringt k3s mit, was ein Cluster sonst einzeln braucht:

| Bestandteil              | Wofür                                                                     |
|--------------------------|---------------------------------------------------------------------------|
| containerd               | Container-Runtime (startet die Container der Pods)                        |
| Flannel                  | Pod-Netz: Jeder Pod bekommt eine eigene IP, Pods erreichen sich direkt    |
| CoreDNS                  | DNS im Cluster: Ein Service `backend` heißt dort `backend.<namespace>.svc` |
| Traefik                  | Ingress-Controller: nimmt HTTP auf Port 80/443 an, verteilt nach Host/Pfad |
| ServiceLB (Klipper)      | Gibt Services vom Typ `LoadBalancer` die IP der VM, hier für Traefik      |
| local-path-provisioner   | Persistente Volumes als Verzeichnisse auf der VM-Disk (für die DB)        |
| metrics-server           | CPU/RAM der Pods, Grundlage für `kubectl top` und den HPA                 |

## 1. VM anlegen

Wie in [vm.md](vm.md#1-vm-anlegen) mit virt-manager, mit etwas mehr Platz:

- Image: Debian 13 „trixie“, netinst-ISO
- Name `k3s`, **2 vCPU, 4 GB RAM, 30 GB Disk** (Images und DB-Volume liegen auf der VM-Disk)
- Bei der Installation: kein Desktop, nur „SSH server“ und „Standard-Systemwerkzeuge“. Einen
  normalen User anlegen, im Folgenden `admin` (Platzhalter für deinen Usernamen)

### Swap ausschalten

**Nötig ist das bei k3s nicht.** Das klassische Kubernetes (kubeadm) startet mit Swap gar nicht
erst: Der kubelet bricht ab (`failSwapOn`). k3s schaltet diese Prüfung ab und läuft auch mit Swap.
Seit Kubernetes 1.28 kann der kubelet mit Swap umgehen, und standardmäßig (`swapBehavior: NoSwap`)
lagern die Pods selbst nicht aus, nur die übrigen Prozesse der VM.

**Wir schalten ihn trotzdem ab**, damit sich der Node verhält wie die Nodes in AKS (M8), die keinen
Swap haben. Kubernetes plant Pods anhand ihres RAM-Bedarfs ein (`requests`, `limits`). Reicht der
RAM nicht, verdrängt der kubelet Pods oder der Kernel beendet einen Container (OOMKilled). Das ist
gewollt, denn es ist sichtbar: Der Pod startet neu, `kubectl describe` zeigt den Grund. Mit Swap
würde die VM stattdessen langsam auslagern, und das sieht man schlechter. Debians Installer legt
standardmäßig eine Swap-Partition an:

```bash
sudo swapoff -a
sudo sed -i '/\sswap\s/ s/^/#/' /etc/fstab   # beim nächsten Boot nicht wieder einhängen
free -h                                      # Swap: 0B
```

### Feste IP: 192.168.122.51

Die VM bekommt ihre IP per DHCP aus dem libvirt-Netz `default`. Ändert sie sich, zeigt die
kubeconfig ins Leere. Statt die IP in der VM statisch einzutragen, reservieren wir sie im
DHCP-Server von libvirt (dnsmasq) für die MAC-Adresse der VM. So bleibt die VM selbst
unverändert, und die Zuordnung steht an einer Stelle auf dem Host.

Auf dem Host:

```bash
export LIBVIRT_DEFAULT_URI=qemu:///system
virsh net-dhcp-leases default            # .51 darf nicht an eine andere VM vergeben sein
virsh domiflist k3s                      # MAC-Adresse, z. B. 52:54:00:ab:cd:ef

# Reservierung eintragen: --live wirkt sofort, --config bleibt nach Neustart des Netzes
virsh net-update default add ip-dhcp-host \
  "<host mac='52:54:00:ab:cd:ef' name='k3s' ip='192.168.122.51'/>" --live --config
virsh net-dumpxml default                # unter <dhcp> steht jetzt die host-Zeile

virsh reboot k3s                         # holt sich beim Booten die neue Adresse
```

Danach vom Host aus:

```bash
ssh admin@192.168.122.51
ip -4 addr                               # in der VM: 192.168.122.51
```

Ändern oder entfernen geht mit `virsh net-update default modify …` bzw. `delete …` und derselben
`<host …/>`-Zeile.

## 2. k3s installieren

In der VM als `admin` (das netinst-Debian hat kein `curl`):

```bash
sudo apt-get update && sudo apt-get install -y curl
curl -sfL https://get.k3s.io | sh -
```

Das Skript lädt das k3s-Binary (Kanal `stable`), richtet den systemd-Dienst `k3s` ein und legt
`kubectl` als Link auf k3s an. Prüfen:

```bash
sudo systemctl status k3s          # active (running)
sudo kubectl get nodes             # k3s   Ready   control-plane   …   v1.36.5+k3s1
sudo kubectl get pods -A           # coredns, traefik, metrics-server, local-path-provisioner,
                                   # svclb-traefik: Running; helm-install-traefik*: Completed
```

Getestet mit **k3s v1.36.5+k3s1** (Oktober 2026), also Kubernetes 1.36. Gegen diese Version
prüfen wir das Chart (`kubeconform`).

`helm-install-traefik` zeigt oft 1–2 Restarts. Das ist normal: Der Job wartet darauf, dass
`helm-install-traefik-crd` die Traefik-CRDs angelegt hat, scheitert bis dahin und wird neu gestartet.
`traefik` und `svclb-traefik` stehen in der ersten Minute auf `ContainerCreating` (Image-Download).

Traefik antwortet schon auf Port 80, hat aber noch keine Routen. Vom Host aus:

```bash
curl -i http://192.168.122.51/      # HTTP/1.1 404 Not Found, "404 page not found" von Traefik
```

## 3. Zugriff vom Host

`kubectl` braucht eine **kubeconfig**: Adresse der API, das CA-Zertifikat des Clusters und
Zugangsdaten. k3s schreibt eine nach `/etc/rancher/k3s/k3s.yaml`. Deren Zugangsdaten sind
**cluster-admin**, also volle Rechte auf den Cluster: Datei wie ein Passwort behandeln.

In der VM eine Kopie für deinen User lesbar machen:

```bash
sudo install -m 600 -o "$USER" -g "$USER" /etc/rancher/k3s/k3s.yaml ~/k3s.yaml
```

Auf dem Host `kubectl` und `helm` installieren und die Datei holen. Auf Bluefin kommen
Kommandozeilen-Werkzeuge über Homebrew (nach `/home/linuxbrew`, ohne Neustart), nicht per
`rpm-ostree install` ins System-Image. Vielleicht sind sie auch schon da:

```bash
command -v kubectl helm || brew install kubectl helm

mkdir -p ~/.kube
scp admin@192.168.122.51:k3s.yaml ~/.kube/cloudpoc-k3s.yaml
chmod 600 ~/.kube/cloudpoc-k3s.yaml
ssh admin@192.168.122.51 rm k3s.yaml

# Die Datei zeigt auf 127.0.0.1 (aus Sicht der VM), vom Host aus ist es die VM-IP.
# Das Zertifikat der API gilt auch für die IP der VM, k3s trägt sie selbst ein.
sed -i 's/127.0.0.1/192.168.122.51/' ~/.kube/cloudpoc-k3s.yaml
```

Die Datei bewusst nicht als `~/.kube/config` ablegen, sondern pro Shell einschalten. So schickt
kein `kubectl` versehentlich Befehle an diesen Cluster (später auch an AKS) ohne dass man es merkt:

```bash
export KUBECONFIG=~/.kube/cloudpoc-k3s.yaml
kubectl config rename-context default k3s-cloudpoc    # einmalig, statt "default"
kubectl get nodes
kubectl top node                                       # CPU/RAM, via metrics-server
```

Läuft `kubectl get nodes` vom Host aus, ist Schritt 1 fertig.

## 4. CloudNativePG-Operator

### Was ein Operator ist

Kubernetes kennt von Haus aus nur allgemeine Bausteine: Pods, Deployments, Services, Volumes.
Eine Datenbank braucht mehr Wissen: `initdb` beim ersten Start, Benutzer und Passwörter anlegen,
Backups, Wiederherstellung, Upgrades. Ein **Operator** bringt dieses Wissen in den Cluster:

1. Er definiert einen **neuen Ressourcentyp** (CRD), hier `Cluster` von `postgresql.cnpg.io`.
2. Er läuft selbst als Pod und **beobachtet** diese Ressourcen. Legt jemand einen `Cluster` an,
   erzeugt der Operator daraus Pods, Volumes, Services und Secrets, und hält sie dauerhaft im
   beschriebenen Zustand (stirbt ein Pod, baut er ihn neu, mit denselben Daten).

Wir beschreiben also nur noch, **was** wir wollen („eine Postgres-17-Instanz mit 1 GB Platz“),
das **Wie** erledigt der Operator. Dasselbe Prinzip wie bei Deployments, nur mit Datenbank-Wissen.

Der Operator wird **einmal pro Cluster** installiert (Namespace `cnpg-system`). Unser Chart legt
später pro Umgebung nur noch eine `Cluster`-Ressource an.

### Installieren

Per Helm aus dem offiziellen Chart-Repo, auf dem Host:

```bash
export KUBECONFIG=~/.kube/cloudpoc-k3s.yaml
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update
helm search repo cnpg/cloudnative-pg              # CHART VERSION und APP VERSION (= Operator)

helm upgrade --install cnpg cnpg/cloudnative-pg \
  --namespace cnpg-system --create-namespace \
  --version 0.29.1 --wait
```

- `upgrade --install`: installiert beim ersten Mal, aktualisiert danach. Derselbe Befehl taugt
  also für beides, deshalb nutzen ihn Skripte und Workflows gern.
- `--version`: Chart-Version festhalten, sonst nimmt Helm die neueste, und zwei Installationen
  sind nicht mehr gleich. Getestet mit Chart 0.29.1 = Operator 1.30.1 (Oktober 2026);
  neuere Versionen zeigt `helm search repo cnpg/cloudnative-pg`.
- `--wait`: kehrt erst zurück, wenn der Operator-Pod bereit ist.

Prüfen:

```bash
helm list -n cnpg-system                            # cnpg   deployed   cloudnative-pg-…
kubectl get pods -n cnpg-system                     # cnpg-cloudnative-pg-…   1/1 Running
kubectl get crd | grep cnpg                         # clusters.postgresql.cnpg.io, backups…, …
```

### Test-Cluster zum Anschauen

Bevor das Chart eine DB anlegt, einmal von Hand, um zu sehen, was der Operator erzeugt:

```bash
kubectl create namespace cnpg-test
kubectl apply -n cnpg-test -f - <<EOT
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: pg-test
spec:
  instances: 1
  imageName: ghcr.io/cloudnative-pg/postgresql:17
  storage:
    size: 1Gi
EOT

kubectl get cluster -n cnpg-test -w                 # bis STATUS "Cluster in healthy state" (Strg+C)
kubectl get pods,pvc,svc,secret -n cnpg-test
```

Was dabei entsteht:

| Objekt                                        | Bedeutung                                                     |
|-----------------------------------------------|---------------------------------------------------------------|
| Pod `pg-test-1-initdb-…` (Completed)          | Einmal-Job: `initdb`, legt DB `app` mit Owner `app` an         |
| Pod `pg-test-1`                               | Die Postgres-Instanz                                          |
| PVC `pg-test-1`                               | Das Volume (von local-path auf der VM-Disk)                   |
| Services `pg-test-rw`, `-ro`, `-r`            | Lesen+Schreiben (Primary), nur Replikas, beliebige Instanz    |
| Secret `pg-test-app`                          | Zugangsdaten für `app`, inkl. fertiger `uri`                  |

Die App würde sich später mit `pg-test-rw` verbinden und die Zugangsdaten aus `pg-test-app` lesen:

```bash
kubectl get secret -n cnpg-test pg-test-app -o jsonpath='{.data.uri}' | base64 -d; echo
kubectl exec -n cnpg-test pg-test-1 -- psql -U postgres -d app -c 'select version()'
```

**Selbstheilung ausprobieren:** Pod löschen und zusehen, wie der Operator ihn neu baut. Das Volume
bleibt, die Daten also auch:

```bash
kubectl exec -n cnpg-test pg-test-1 -- psql -U postgres -d app -c 'create table t (x int); insert into t values (42)'
kubectl delete pod -n cnpg-test pg-test-1
kubectl get pods -n cnpg-test -w                    # pg-test-1 kommt wieder (Strg+C)
kubectl exec -n cnpg-test pg-test-1 -- psql -U postgres -d app -c 'select * from t'   # 42
```

Aufräumen (der Namespace samt allem darin, auch dem Volume):

```bash
kubectl delete namespace cnpg-test
```

## 5. App per Helm-Chart: zuerst das Frontend

Das Chart liegt in `deploy/helm/cloudpoc/`. Ein **Chart** ist ein Ordner mit Vorlagen
(`templates/`) für Kubernetes-Objekte und Standardwerten (`values.yaml`). `helm` setzt die Werte
in die Vorlagen ein und schickt das Ergebnis an die API. Eine installierte Instanz heißt
**Release**; Helm merkt sich jede Version davon (`helm history`) und kann zurückrollen.

Prüfen ohne Cluster: `make helm-check` (helm lint und kubeconform für alle Werte-Varianten,
Teil von `make test` und der CI).

Das Chart wächst schrittweise. Im ersten Schritt nur das Frontend:

| Datei                                | Objekt       | Aufgabe                                                      |
|--------------------------------------|--------------|--------------------------------------------------------------|
| `templates/frontend-deployment.yaml` | Deployment   | Hält `replicas` Pods mit dem Frontend-Image am Laufen         |
| `templates/frontend-service.yaml`    | Service      | Feste Adresse vor den Pods, nur im Cluster                    |
| `templates/frontend-configmap.yaml`  | ConfigMap    | `config.json` der Umgebung, im Pod als Datei eingehängt       |
| `templates/ingress.yaml`             | Ingress      | Regel für Traefik: `/` → Frontend-Service                     |
| `templates/_helpers.tpl`             | –            | Gemeinsame Bausteine: Namen, Labels, Image                   |

Was im Cluster daraus wird:

```
Browser ─▶ Traefik ─(Ingress-Regel "/")─▶ Service <release>-frontend ─▶ Pod(s) nginx :8080
                                                                         └ /config.json aus der ConfigMap
```

### Namespaces: einer pro App und Umgebung

Ein **Namespace** ist ein benannter Bereich im Cluster. Namen müssen nur darin eindeutig sein, Rechte
(Abschnitt 11) und Quotas hängen an ihm, und `kubectl delete namespace` räumt alles darin ab. Eine harte
Isolation ist er nicht: Alle Pods teilen sich die Nodes, und ohne NetworkPolicy erreichen sie sich
auch über Namespace-Grenzen.

Der Cluster ist für mehrere Apps gedacht, deshalb heißen die Namespaces `<app>-<umgebung>`, hier
`cloudpoc-staging`. So sieht der Deployer einer App die Secrets der anderen nicht, und zwei Apps können
ihr Pull-Secret beide `ghcr-pull` nennen. Ordner unter `deploy/secrets/` und Werte-Datei unter
`deploy/helm/values/` tragen denselben Namen.

Solange `ingress.host` leer ist, nimmt der Ingress dieser App **jeden** Hostnamen an. Eine zweite App
oder Umgebung im Cluster braucht deshalb eigene Hostnamen (Wert `ingress.host`), auch für diese hier.

### Pull-Secret für GHCR

Die Images in GHCR sind privat, der Cluster braucht Zugangsdaten zum Herunterladen. Ein Token
(classic) nur mit dem Scope **`read:packages`** anlegen, GHCR akzeptiert keine fine-grained Tokens.
Der Link öffnet das Formular mit vorbelegtem Scope, Ablaufdatum setzen:
<https://github.com/settings/tokens/new?scopes=read:packages&description=k3s-ghcr-pull>
(im Menü: Profilbild → *Settings* → ganz unten *Developer settings* → *Tokens (classic)*).
Dann auf dem Host:

```bash
export KUBECONFIG=~/.kube/cloudpoc-k3s.yaml
kubectl create namespace cloudpoc-staging
kubectl create secret docker-registry ghcr-pull -n cloudpoc-staging \
  --docker-server=ghcr.io --docker-username=dying-surfer \
  --docker-password='<Token>'
```

Das Secret gilt nur in diesem Namespace (jede Umgebung braucht ihr eigenes). Später verwaltet
SOPS solche Secrets verschlüsselt im Repo (Abschnitt 9), für den Anfang legen wir es von Hand an.

### Installieren

Im Repo auf dem Host. Der Image-Tag muss ein Commit sein, für den die CI Images gebaut hat (jeder
Push auf `main`):

```bash
git fetch
helm upgrade --install cloudpoc deploy/helm/cloudpoc -n cloudpoc-staging \
  --set image.tag=$(git rev-parse origin/main) --wait
```

Ohne `image.tag` bricht Helm mit einer Meldung ab: Ein Deploy ohne genaue Version soll es nicht
geben (kein `:latest`).

Prüfen:

```bash
helm list -n cloudpoc-staging                        # cloudpoc   deployed
kubectl get deploy,pods,svc,ingress -n cloudpoc-staging
curl -s http://192.168.122.51/config.json        # {"banner": "STAGING · k3s", …}
curl -s http://192.168.122.51/ | head -5         # index.html der Angular-App
```

Im Browser `http://192.168.122.51/`: Die App lädt und zeigt das Banner, die Ticket-Liste meldet
aber einen Fehler. Das ist erwartet, das Backend fehlt noch.

**Config ändern und neu ausrollen:** Mit einem anderen Wert für das Banner sieht man, wie Helm
eine neue Release-Version erzeugt und Kubernetes die Pods austauscht:

```bash
helm upgrade cloudpoc deploy/helm/cloudpoc -n cloudpoc-staging --reset-then-reuse-values \
  --set frontend.config.banner="STAGING · geändert" --wait
kubectl get pods -n cloudpoc-staging                 # neuer Pod-Name: neue Config = neues Pod-Template
helm history cloudpoc -n cloudpoc-staging            # Revision 1 und 2
helm rollback cloudpoc 1 -n cloudpoc-staging --wait  # zurück zum alten Banner
```

`--reset-then-reuse-values` übernimmt die Werte, die beim letzten Mal per `--set`/`-f` gesetzt
wurden (hier `image.tag`), und nimmt für alles andere die **aktuellen** Standardwerte des Charts.
Das ältere `--reuse-values` übernimmt dagegen den kompletten alten Wertestand: Neue Werte, die
ein späterer Chart-Stand einführt, fehlen dann, und die Templates brechen ab (Fehlersuche in
`docs/dev.md`).

Der Pod wird ausgetauscht, weil das Pod-Template eine Prüfsumme der ConfigMap trägt
(`checksum/config`). Ohne sie bliebe der alte Pod mit der alten Datei stehen.

## 6. Backend und Datenbank

Dazu kommen im Chart:

| Datei                                | Objekt          | Aufgabe                                                        |
|--------------------------------------|-----------------|----------------------------------------------------------------|
| `templates/db-cluster.yaml`          | CNPG `Cluster`  | Postgres 17 (`db.mode=cnpg`), wie der Test-Cluster aus Abschnitt 4 |
| `templates/backend-deployment.yaml`  | Deployment      | FrankenPHP-Pods, `DATABASE_URL` aus dem Secret des Operators    |
| `templates/backend-service.yaml`     | Service         | Feste Adresse vor den Backend-Pods                             |
| `templates/ingress.yaml`             | Ingress         | jetzt auch `/api`, `/healthz`, `/readyz` → Backend              |

```
Browser ─▶ Traefik ─┬─ /api, /healthz, /readyz ─▶ Service cloudpoc-backend ─▶ Pod FrankenPHP
                    │                                                           │ DATABASE_URL
                    │                                                           ▼
                    │                                Service cloudpoc-db-rw ─▶ Pod cloudpoc-db-1 (Postgres)
                    └─ / ──────────────────────────▶ Service cloudpoc-frontend ─▶ Pod nginx
```

Die Zugangsdaten zur DB erzeugt der Operator selbst (Secret `cloudpoc-db-app`), das Chart reicht
nur das Passwort an das Backend weiter. Die DB trägt `helm.sh/resource-policy: keep`:
`helm uninstall` lässt sie samt Daten stehen.

### Secret fürs Backend

`APP_SECRET` (Symfony) kommt wie das Pull-Secret erst einmal von Hand in den Namespace (per SOPS: Abschnitt 9):

```bash
kubectl create secret generic cloudpoc-backend -n cloudpoc-staging \
  --from-literal=APP_SECRET=$(openssl rand -hex 32)
```

### Ausrollen

```bash
helm upgrade --install cloudpoc deploy/helm/cloudpoc -n cloudpoc-staging \
  --set image.tag=$(git rev-parse origin/main) --wait --timeout 5m

kubectl get cluster,pods,svc,ingress -n cloudpoc-staging
```

Reihenfolge im Cluster: Der Operator legt die DB an (`cloudpoc-db-1-initdb-…`, dann `cloudpoc-db-1`).
Bis es das Secret `cloudpoc-db-app` gibt, steht der Backend-Pod auf `CreateContainerConfigError`;
der kubelet versucht es weiter und startet ihn, sobald das Secret da ist. Kein Fehler, sondern das
übliche „so lange wiederholen, bis es passt“.

```bash
curl -s http://192.168.122.51/readyz              # {"status":"ok",…}: Backend erreicht die DB
curl -s http://192.168.122.51/api/tickets         # Fehler 500: Tabelle fehlt noch
```

### Migration einmal von Hand

Die DB ist leer, das Schema fehlt. Seit Abschnitt 7 erledigt das ein Job automatisch; einmal von Hand
zeigt, was der Job tun wird: dasselbe Image, nur ein anderer Befehl.

```bash
kubectl exec -n cloudpoc-staging deploy/cloudpoc-backend -- \
  php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration
curl -s http://192.168.122.51/api/tickets         # {"items":[],…}
```

Im Browser `http://192.168.122.51/`: Tickets anlegen, bearbeiten, löschen.

**Daten überleben einen Neustart der DB:**

```bash
kubectl delete pod -n cloudpoc-staging cloudpoc-db-1
kubectl get pods -n cloudpoc-staging -w                    # cloudpoc-db-1 kommt wieder (Strg+C)
```

Danach sind die Tickets noch da.

## 7. Migrationen als Job

`templates/migrate-job.yaml` ist ein **Job**: ein Pod, der einmal bis zum Ende läuft, hier mit
dem Backend-Image und `doctrine:migrations:migrate`. Wann er läuft, bestimmt ein **Helm-Hook**
(Annotation `helm.sh/hook`), ein Objekt, das Helm zu einem festen Zeitpunkt anlegt und auf
dessen Ende es wartet:

| Hook           | Wann                                   | Warum so                                                    |
|----------------|----------------------------------------|-------------------------------------------------------------|
| `post-install` | erster Install, nach allen Objekten    | Die DB entsteht erst mit dem Install. Ein `pre-install`-Hook liefe davor und wartete vergeblich |
| `pre-upgrade`  | jeder weitere Deploy, vor allem anderen | Neue Backend-Pods finden das neue Schema schon vor           |

Scheitert der Job bei einem Upgrade, bricht `helm upgrade` ab, und die alten Pods laufen weiter
(gegen ein vielleicht schon teilweise migriertes Schema, deshalb rückwärtskompatible Migrationen).
`helm rollback` dreht Migrationen nicht zurück.

Verworfen: Migration als initContainer im Backend-Pod. Bei mehreren Replikas migrierten mehrere
Pods gleichzeitig, und bei jedem Neustart eines Pods liefe sie wieder mit.

### Erster Install ohne Handarbeit

Release und DB entfernen und neu installieren. Die DB muss extra weg, weil sie
`helm.sh/resource-policy: keep` trägt. Die Secrets `ghcr-pull` und `cloudpoc-backend` bleiben
(sie gehören nicht zum Release):

```bash
helm uninstall cloudpoc -n cloudpoc-staging
kubectl delete cluster cloudpoc-db -n cloudpoc-staging     # löscht auch das Volume: Daten weg
kubectl get all,pvc -n cloudpoc-staging                    # leer (bis auf evtl. auslaufende Pods)

helm upgrade --install cloudpoc deploy/helm/cloudpoc -n cloudpoc-staging \
  --set image.tag=$(git rev-parse origin/main) --wait --timeout 5m
```

Ablauf: Helm legt DB, Deployments, Services und Ingress an und wartet (`--wait`), bis alles bereit
ist. Dann startet der Hook den Job:

```bash
kubectl get jobs,pods -n cloudpoc-staging                  # cloudpoc-migrate 1/1 Complete
kubectl logs -n cloudpoc-staging job/cloudpoc-migrate      # [notice] Migrating up to …
curl -s http://192.168.122.51/api/tickets         # {"items":[],…}, ohne kubectl exec
```

### Upgrade

Bei jedem weiteren `helm upgrade` läuft der Job zuerst. Gibt es nichts zu migrieren, meldet er das
und ist nach Sekunden fertig. Der Job des vorigen Deploys bleibt
bis zum nächsten stehen (`hook-delete-policy: before-hook-creation`), damit seine Logs lesbar bleiben.

## 8. Rolling Update ohne Downtime

### Was beim Update passiert

Mit 2 Replikas, Image-Tag A → B (`strategy: RollingUpdate`, Standard):

```
1. pre-upgrade:  Migrations-Job B läuft     Pods: A A        ← A läuft gegen Schema B
2. Rollout:      neuer Pod B startet        Pods: A A B      (B noch nicht ready)
3.               B ist ready                Pods: A A B      → B bekommt Traffic
4.               ein A wird beendet         Pods: A B
5.               dasselbe für das zweite A  Pods: A B B → B B
```

- **Readiness:** Ein neuer Pod bekommt erst Traffic, wenn `/readyz` grün ist.
- **`maxSurge: 1`, `maxUnavailable: 0`:** Kubernetes startet erst einen zusätzlichen Pod und
  beendet einen alten erst, wenn Ersatz bereit ist. Es fehlt also nie ein Pod.
- **`preStop`-Pause (5 s):** Beim Beenden bekommt der Pod `SIGTERM`, FrankenPHP und nginx
  beantworten laufende Requests noch zu Ende. Traefik erfährt aber erst kurz danach, dass der Pod
  wegfällt, und schickt ihm sonst noch neue Requests (502). Die Pause davor überbrückt das.

### Migrationen: expand/contract

Während des Updates läuft **alter Code gegen das neue Schema** (ab Schritt 1), und **beide
Versionen laufen gleichzeitig** (Schritte 2–5). Jede Migration muss deshalb zur direkt vorherigen
Code-Version passen. Doctrine fragt immer genau die Spalten ab, die die Entity kennt:

| Änderung                                  | Alter Code                              | Unbedenklich? |
|-------------------------------------------|-----------------------------------------|---------------|
| Neue Tabelle                              | kennt sie nicht, stört nicht            | ja            |
| Neue Spalte, nullable oder mit Default    | ignoriert sie, `INSERT` geht weiter     | ja            |
| Neue Spalte `NOT NULL` ohne Default       | `INSERT` ohne die Spalte scheitert      | nein          |
| Spalte umbenennen oder löschen            | `SELECT` der alten Spalte scheitert     | nein          |
| Index anlegen                             | merkt nichts (kann Tabelle kurz sperren) | meist         |

Gefährliche Änderungen über **zwei Releases** verteilen, z. B. `assignee` → `assigned_to`:

1. **Expand:** Migration legt `assigned_to` zusätzlich an und kopiert die Daten. Der Code
   schreibt beide Spalten und liest die neue. Alter Code nutzt weiter `assignee`, die es noch gibt.
2. **Contract:** Der Code nutzt nur noch `assigned_to`, die Migration löscht `assignee`.
   Der alte Code ist jetzt Release 1, und der braucht `assignee` nicht mehr.

### Alternative: Recreate (kurz offline)

Mit `--set strategy=Recreate` beendet Kubernetes beim Update **erst alle alten Pods** und startet
dann die neuen. Es laufen nie zwei Versionen gleichzeitig, dafür ist die App ein paar Sekunden
weg (Traefik antwortet mit einem Fehler). Für viele interne Anwendungen ist das völlig in
Ordnung und spart die Disziplin von expand/contract bei jeder Migration.

Einschränkung: Der Migrations-Job läuft auch dann **vor** dem Beenden der alten Pods
(`pre-upgrade`), die alten Pods sehen das neue Schema also noch für die Dauer der Migration.
Soll das bei einer heiklen Migration gar nicht vorkommen, das Backend vorher von Hand stoppen:

```bash
kubectl scale deployment cloudpoc-backend -n cloudpoc-staging --replicas=0
helm upgrade cloudpoc deploy/helm/cloudpoc -n cloudpoc-staging --reset-then-reuse-values \
  --set image.tag=<SHA> --set strategy=Recreate --wait
```

`helm upgrade` setzt `replicas` danach wieder auf den Wert aus den values.

### Prod-Werte

`values-prod.yaml` überschreibt nur, was in Prod anders ist: 2 Frontend-Pods, Backend per
**HorizontalPodAutoscaler** (2–4 Pods nach CPU-Last, Grundlage ist der metrics-server),
**PodDisruptionBudgets** und kein Banner. Ein PDB hält bei geplanten Störungen (Node-Wartung,
`kubectl drain`) mindestens einen Pod am Leben; mit dem Rolling Update selbst hat er nichts zu
tun. Mit HPA fehlt `replicas` im Deployment, sonst setzte jedes `helm upgrade` die Anzahl zurück.

### Test: Update unter Last

Probehalber mit den Prod-Werten in `cloudpoc-staging`:

```bash
helm upgrade cloudpoc deploy/helm/cloudpoc -n cloudpoc-staging --reset-then-reuse-values \
  -f deploy/helm/cloudpoc/values-prod.yaml --wait
kubectl get pods,pdb,hpa -n cloudpoc-staging              # je 2 Frontend- und Backend-Pods
```

In einem zweiten Terminal Requests im Dauerlauf, jeder Statuscode eine Zeile:

```bash
while true; do curl -s -o /dev/null -w '%{http_code}\n' http://192.168.122.51/api/tickets; sleep 0.1; done \
  | tee ~/rollout-codes.txt
```

Im ersten Terminal ein Update auslösen. `rollout restart` tauscht alle Pods aus wie bei einem
neuen Image, ohne dass es eines braucht:

```bash
kubectl rollout restart deployment -n cloudpoc-staging
kubectl rollout status deployment/cloudpoc-backend -n cloudpoc-staging
kubectl get pods -n cloudpoc-staging -w                   # alte gehen erst, wenn neue ready sind (Strg+C)
```

Dann die Schleife mit Strg+C beenden und auswerten:

```bash
sort ~/rollout-codes.txt | uniq -c               # nur 200
```

**Stand Oktober 2026: noch offen.** Der erste Test mit 2 Replikas ergab 32 × 200, 1 × 502 und
1 × 504 (rund 30 s Wartezeit). Verdacht: Traefik schickt noch Requests an Pods, die schon
beendet werden. Die Access-Logs unten sind eingeschaltet, um das zu belegen; ausgewertet ist es
noch nicht.

**Gegenprobe** (zeigt, wofür die Einstellungen da sind): dasselbe mit
`--set preStopSleepSeconds=0` (vereinzelt 502) oder `--set strategy=Recreate` (eine Lücke mit
Fehlern). Danach mit `--set preStopSleepSeconds=5 --set strategy=RollingUpdate` zurück.

Zurück auf die Staging-Werte: `helm upgrade` ohne `-f values-prod.yaml` und ohne `--reset-then-reuse-values`,
nur mit `--set image.tag=…`.

### Traefik-Access-Logs

Das von k3s mitgebrachte Traefik (getestet: 3.7.13) loggt standardmäßig nur eigene Fehler, nicht
einzelne Requests. Eine 502 oder 504 taucht dort also nicht auf. Access-Logs einschalten:

```bash
kubectl apply -f deploy/k3s/traefik-config.yaml
kubectl rollout status deployment/traefik -n kube-system
```

`deploy/k3s/traefik-config.yaml` ist eine **HelmChartConfig**: k3s installiert Traefik selbst per
Helm-Chart (die `helm-install-traefik`-Jobs aus Abschnitt 2), und über diese Ressource mit
gleichem Namen überschreibt man dessen Values. Danach eine Zeile pro Request:

```bash
kubectl logs -n kube-system deploy/traefik -f | grep /api/
# … "GET /api/tickets HTTP/1.1" 200 … "cloudpoc-staging-cloudpoc-…@kubernetes" "http://10.42.0.23:8080" 4ms
```

Die vorletzte Angabe ist der Pod, an den Traefik den Request geschickt hat, die letzte die Dauer.

## 9. Secrets mit SOPS

### Welche Secrets es gibt

| Secret             | Inhalt                       | Woher der Wert kommt                      | Verwaltet über                 |
|--------------------|------------------------------|-------------------------------------------|--------------------------------|
| `cloudpoc-db-app`  | DB-Passwort (User `app`)     | CNPG-Operator, zufällig beim ersten Start | Operator (nicht im Repo)       |
| `cloudpoc-backend` | `APP_SECRET` (Symfony)       | von uns erzeugt (`openssl rand`)          | SOPS, `deploy/secrets/<ns>/`   |
| `ghcr-pull`        | Token zum Image-Pull (GHCR)  | GitHub, Token (classic) `read:packages`   | SOPS, `deploy/secrets/<ns>/`   |

Das DB-Passwort braucht kein SOPS: Niemand außerhalb des Clusters muss es vorher kennen. Der
Operator erzeugt es, legt damit die Rolle `app` an und schreibt es ins Secret. Das Backend-Deployment
enthält nur einen Verweis darauf, der kubelet setzt den Wert beim Start des Pods als
Umgebungsvariable (Abschnitt 6). Alles, was von außen kommt, liegt dagegen verschlüsselt im Repo.

Secrets im Cluster sind nur base64-kodiert, nicht verschlüsselt (auch nicht in der Datenbank von k3s).
Geschützt sind sie über die Rechte: Wer `get secret` darf (unsere kubeconfig ist Cluster-Admin),
root auf der VM und wer im Namespace Pods starten darf, kann sie lesen.

### Wie SOPS funktioniert

`sops` verschlüsselt in einer YAML-Datei nur die **Werte**, die Schlüssel bleiben lesbar. Welche
Werte, steht in `.sops.yaml` im Repo: unter `deploy/secrets/cloudpoc-staging/` nur `data`/`stringData`.
Name, Namespace und Typ des Secrets sind also im Diff sichtbar, der Inhalt nicht.

Verschlüsselt wird mit **age**, einem Schlüsselpaar:

- öffentlicher Schlüssel (`age1…`): steht in `.sops.yaml`, damit kann jeder verschlüsseln
- privater Schlüssel: nur auf dem Host in `~/.config/sops/age/keys.txt` (dort sucht sops ihn),
  zusätzlich im Passwortmanager. Nur damit lässt sich entschlüsseln. Nie ins Repo oder in den
  Devcontainer.

**Ist der private Schlüssel weg, sind die Dateien im Repo wertlos.** Dann neues Schlüsselpaar,
`.sops.yaml` anpassen und alle Werte neu erzeugen (Token neu ausstellen, neues `APP_SECRET`).

Die `.gitignore` sperrt jeden Ordner `secrets/`, mit einer Ausnahme: unter `deploy/secrets/` dürfen
`*.sops.yaml`-Dateien ins Repo. `make secrets-check` (Teil von `make test` und CI) prüft, dass sie
wirklich verschlüsselt sind, ohne sops oder Schlüssel.

### Einrichten (einmal, Host)

```bash
brew install sops age
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt       # gibt "Public key: age1…" aus
chmod 600 ~/.config/sops/age/keys.txt
age-keygen -y ~/.config/sops/age/keys.txt       # öffentlichen Schlüssel später wieder anzeigen
```

Getestet mit sops 3.13.3. Den Inhalt von `keys.txt` in den Passwortmanager.

### Anwenden

Im Repo auf dem Host (sops findet `.sops.yaml` nur von dort), mit `KUBECONFIG`:

```bash
make k8s-secrets NS=cloudpoc-staging
```

Für jede Datei in `deploy/secrets/cloudpoc-staging/`: `sops -d … | kubectl apply -f -`. Der Klartext läuft
nur durch die Pipe. Beim ersten Mal auf ein von Hand angelegtes Secret warnt `kubectl apply`
wegen der fehlenden Annotation `last-applied-configuration` und ergänzt sie, danach ist Ruhe.

In einem neuen Namespace kommt das vor dem ersten `helm upgrade --install`, sonst fehlen dem
Backend `APP_SECRET` und dem Cluster die Zugangsdaten für GHCR.

### Neues Secret anlegen

Manifest per `--dry-run=client` erzeugen (legt nichts an) und sofort verschlüsseln. Zwischen den
beiden Befehlen steht der Klartext kurz auf der Platte, deshalb erst danach committen:

```bash
kubectl create secret generic <name> -n cloudpoc-staging --from-literal=KEY=<wert> \
  --dry-run=client -o yaml > deploy/secrets/cloudpoc-staging/<name>.sops.yaml
sops -e -i deploy/secrets/cloudpoc-staging/<name>.sops.yaml
make secrets-check
```

Die beiden vorhandenen Dateien sind so aus den von Hand angelegten Secrets entstanden (Wert per
`kubectl get secret … -o jsonpath='{.data.KEY}' | base64 -d` aus dem Cluster gelesen).

### Werte ändern (Passwortwechsel)

Grundablauf für alles, was per SOPS kommt:

```bash
sops edit deploy/secrets/cloudpoc-staging/<name>.sops.yaml   # öffnet $EDITOR mit Klartext, verschlüsselt beim Speichern
make k8s-secrets NS=cloudpoc-staging
git commit …
```

Mit `sops edit` stehen die Werte als Klartext unter `data`, aber base64-kodiert (so steht es im
Secret). Einfacher: den Wert unter `stringData` als Klartext eintragen und den alten Eintrag unter
`data` löschen, Kubernetes kodiert selbst.

**Wichtig:** Umgebungsvariablen liest ein Pod nur beim Start. Ein geändertes Secret kommt erst nach
einem Neustart an, `kubectl apply` allein ändert an laufenden Pods nichts.

**`APP_SECRET`:**

```bash
openssl rand -hex 32                                # neuen Wert erzeugen, per sops edit eintragen
make k8s-secrets NS=cloudpoc-staging
kubectl rollout restart deployment/cloudpoc-backend -n cloudpoc-staging
```

Der Neustart läuft als Rolling Update (Abschnitt 8). Symfony signiert damit z. B. CSRF-Tokens und
Login-Links, die werden ungültig. Unsere API nutzt das bisher nicht.

**GHCR-Token** (läuft ab, Ablaufdatum aus Abschnitt 5 im Kalender notieren): neuen Token anlegen
(Link in Abschnitt 5), Datei neu erzeugen und verschlüsseln. Die Docker-Config ist JSON in base64,
von Hand editieren lohnt nicht:

```bash
kubectl create secret docker-registry ghcr-pull -n cloudpoc-staging \
  --docker-server=ghcr.io --docker-username=dying-surfer --docker-password='<neuer Token>' \
  --dry-run=client -o yaml > deploy/secrets/cloudpoc-staging/ghcr-pull.sops.yaml
sops -e -i deploy/secrets/cloudpoc-staging/ghcr-pull.sops.yaml
make k8s-secrets NS=cloudpoc-staging
```

Kein Neustart nötig: Das Pull-Secret liest der kubelet bei jedem Image-Pull neu. Danach den alten
Token auf GitHub löschen. Ein abgelaufener Token fällt erst beim nächsten Pull auf (neuer Pod auf
einem Node ohne das Image, neuer Tag), als `ImagePullBackOff`.

## 10. Deploy mit einem Befehl

Bisher: Secrets anwenden, dann `helm upgrade` mit den richtigen Optionen von Hand. Das fasst ein
Target zusammen, das später auch der Deploy-Workflow aufruft (wie `make deploy` auf der Compose-VM):

```bash
git fetch
make k8s-deploy NS=cloudpoc-staging TAG=$(git rev-parse origin/main)
```

Was passiert:

1. `make k8s-secrets NS=cloudpoc-staging` (Abschnitt 9).
2. `helm upgrade --install cloudpoc deploy/helm/cloudpoc -n cloudpoc-staging -f deploy/helm/values/cloudpoc-staging.yaml
   --set image.tag=<TAG> --wait --timeout 5m`. Der Migrations-Job läuft wie gehabt als Hook (Abschnitt 7).

**Werte pro Namespace:** `deploy/helm/values/<namespace>.yaml`, der Dateiname ist der Namespace. Fehlt die
Datei, bricht das Target ab. `make helm-check` prüft jede dieser Dateien mit.

**Kein `--reset-then-reuse-values`:** Bei den Handversuchen oben merkt sich Helm, was per `--set` gesetzt
wurde, der Zustand steckt also im Cluster. Hier kommen alle Werte aus dem Repo (Chart-Defaults, Werte-Datei,
`TAG`), jeder Deploy setzt sie neu. Folge: Ein von Hand gesetzter Wert (`--set strategy=Recreate`,
`-f values-prod.yaml`) ist nach dem nächsten `make k8s-deploy` wieder weg. Dauerhaftes gehört in die Werte-Datei.

**`TAG` muss ein voller Commit-SHA sein** (40 Zeichen). Ohne Angabe hätte `TAG` den Wert `local` aus den
Image-Builds im selben Makefile, das Target lehnt das ab. Zu dem SHA muss die CI Images gebaut haben, sonst
endet der Deploy nach 5 Minuten mit `ImagePullBackOff`.

Der Namespace muss schon existieren (`kubectl create namespace …`), das Target legt ihn nicht an.

## 11. Deploy-Workflow: Runner in der k3s-VM

Wie bei der Compose-VM (docs/vm.md) deployt ein Self-hosted Runner, der in der VM läuft und sich selbst
bei GitHub meldet. Die k3s-API (Port 6443) muss dafür nicht von außen erreichbar sein.

Der Runner bekommt **nicht** die Admin-kubeconfig und **nicht** deinen age-Schlüssel, sondern eigene,
kleinere Zugänge. Wird er kompromittiert (z. B. über einen manipulierten Workflow), ist der Schaden
auf den Namespace `cloudpoc-staging` begrenzt, und beide Zugänge lassen sich einzeln zurückziehen.

### ServiceAccount `deployer`

Ein **ServiceAccount** ist ein Konto für Programme (dein Admin-Zugang ist ein Zertifikat, kein Konto im
Cluster). Rechte bekommt er über **RBAC**: Eine `Role` listet auf, welche Verben (`get`, `create`, …) auf
welchen Ressourcen in *einem* Namespace erlaubt sind, ein `RoleBinding` verbindet Role und Konto.
Alles, was nicht erlaubt ist, ist verboten.

```bash
kubectl apply -f deploy/k3s/deployer-cloudpoc-staging.yaml
```

Legt im Namespace `cloudpoc-staging` an: ServiceAccount, Role, RoleBinding (alle `deployer`) und das Secret
`deployer-token` mit einem Token ohne Ablaufdatum.

Was die Role erlaubt: die Ressourcen des Charts verwalten (Deployments, Services, ConfigMaps, Ingress,
Jobs, HPA, PDB, CNPG-Cluster), Secrets verwalten, Pods und ReplicaSets nur lesen.

Was das **nicht** verhindert: Der `deployer` kann alle Secrets in `cloudpoc-staging` lesen (auch das DB-Passwort)
und dort beliebige Pods starten. Das geht nicht enger, denn Helm speichert seine Releases selbst als
Secrets. Die Grenze ist der Namespace: kein Zugriff auf `kube-system`, andere Namespaces, Nodes oder CRDs.

### kubeconfig für den `deployer`

Auf dem Host, mit der Admin-kubeconfig in `KUBECONFIG`. Die neue Datei besteht aus denselben drei Teilen
wie in Abschnitt 3 (Adresse, CA-Zertifikat, Zugangsdaten), nur mit dem Token statt des Admin-Zertifikats:

```bash
K=~/.kube/cloudpoc-k3s-deployer.yaml
CA=$(kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
TOKEN=$(kubectl get secret deployer-token -n cloudpoc-staging -o jsonpath='{.data.token}' | base64 -d)

kubectl --kubeconfig "$K" config set-cluster k3s-cloudpoc --server=https://192.168.122.51:6443
kubectl --kubeconfig "$K" config set clusters.k3s-cloudpoc.certificate-authority-data "$CA"
kubectl --kubeconfig "$K" config set-credentials deployer --token="$TOKEN"
kubectl --kubeconfig "$K" config set-context deployer-cloudpoc-staging \
  --cluster=k3s-cloudpoc --user=deployer --namespace=cloudpoc-staging
kubectl --kubeconfig "$K" config use-context deployer-cloudpoc-staging
chmod 600 "$K"
```

Prüfen, in einer **neuen Shell** oder mit umgestelltem `KUBECONFIG`:

```bash
export KUBECONFIG=~/.kube/cloudpoc-k3s-deployer.yaml
kubectl get pods                                   # geht (Namespace cloudpoc-staging ist voreingestellt)
kubectl get pods -n kube-system                    # Forbidden
kubectl get nodes                                  # Forbidden
kubectl auth can-i --list                          # was der deployer in cloudpoc-staging darf

make k8s-deploy NS=cloudpoc-staging TAG=$(git rev-parse origin/main)   # der eigentliche Test
```

Fehlt der Role ein Recht, bricht Helm mit `… is forbidden: User "system:serviceaccount:cloudpoc-staging:deployer"
cannot <verb> resource "<ressource>" …` ab. Die Meldung nennt genau, was in `deployer-cloudpoc-staging.yaml` fehlt.

**Token zurückziehen:** `kubectl delete secret deployer-token -n cloudpoc-staging`, dann die Datei erneut anwenden
und die kubeconfig neu bauen. Das alte Token gilt sofort nicht mehr.
