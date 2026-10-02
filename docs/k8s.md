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
