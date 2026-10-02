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

Diesmal im Terminal statt mit virt-manager, und ohne Installer: Wir starten von Debians fertigem
**Cloud-Image** (eine schon installierte Debian-Disk) und lassen sie beim ersten Boot von
**cloud-init** einrichten (Hostname, User, SSH-Key). So ist die VM in einer Minute da und lässt sich
jederzeit gleich wieder herstellen. Cloud-VMs bei Azure und Co. starten genauso.

Alle Befehle auf dem **Host**. `qemu:///system` ist dieselbe libvirt-Verbindung, die virt-manager
nutzt (ohne die Angabe landen `virsh`/`virt-install` in der User-Session `qemu:///session`, dort
gibt es das Netz `default` nicht):

```bash
export LIBVIRT_DEFAULT_URI=qemu:///system
command -v virt-install virsh qemu-img      # alle drei vorhanden?
virsh list --all                            # zeigt u. a. die M6-VM
virsh net-list                              # Netz "default" aktiv
```

**a) SSH-Key.** Die VM bekommt kein Passwort, der Login geht nur per Key:

```bash
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519
```

**b) Cloud-Image holen und prüfen.** `genericcloud` ist die Variante für VMs (ohne Treiber für
echte Hardware):

```bash
mkdir -p ~/vms/k3s && cd ~/vms/k3s
base=https://cloud.debian.org/images/cloud/trixie/latest
curl -fLO $base/debian-13-genericcloud-amd64.qcow2
curl -fLO $base/SHA512SUMS
sha512sum --check --ignore-missing SHA512SUMS    # debian-13-genericcloud-amd64.qcow2: OK
```

**c) Disk der VM anlegen.** Eine Kopie des Images in libvirts Speicherort, vergrößert auf 30 GB
(Images und DB-Volume liegen dort). Das Dateisystem wächst beim ersten Boot von selbst mit:

```bash
sudo install -m 644 debian-13-genericcloud-amd64.qcow2 /var/lib/libvirt/images/k3s.qcow2
sudo qemu-img resize /var/lib/libvirt/images/k3s.qcow2 30G
```

**d) cloud-init-Konfiguration.** User `admin` mit deinem SSH-Key. `sudo` ohne Passwort, weil der
User keines hat; Login ist nur per Key möglich, die VM hängt nur im lokalen NAT-Netz:

```bash
cat > user-data.yaml <<EOT
#cloud-config
hostname: k3s
users:
  - name: admin
    groups: [sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - $(cat ~/.ssh/id_ed25519.pub)
package_update: true
packages: [curl]
EOT
cat user-data.yaml                               # dein Key steht drin?
```

**e) VM erzeugen und starten.** `--import` = vorhandene Disk booten statt installieren:

```bash
virt-install \
  --name k3s --memory 4096 --vcpus 2 \
  --osinfo debian13 \
  --import --disk /var/lib/libvirt/images/k3s.qcow2,bus=virtio \
  --network network=default,model=virtio \
  --cloud-init user-data=user-data.yaml \
  --graphics none --noautoconsole
```

**Bluefin mit virt-manager als Flatpak:** `virt-install` läuft dann in der Flatpak-Sandbox und sieht
`~/vms` nicht („user-data.yaml“ nicht gefunden). Den Ordner beim Aufruf freigeben und den Pfad
absolut angeben (`--cloud-init user-data=$HOME/vms/k3s/user-data.yaml`):

```bash
alias virt-install='flatpak run --filesystem=~/vms --command=virt-install org.virt_manager.virt-manager'
```

Die Disk unter `/var/lib/libvirt/images` braucht keine Freigabe, die öffnet libvirtd auf dem Host.

Kennt `virt-install` `debian13` noch nicht (Fehler „Unknown OS name“), stattdessen
`--osinfo linux2024` nehmen. Das steuert nur Voreinstellungen für virtuelle Hardware.

**f) IP herausfinden und einloggen.** Die VM holt sich per DHCP eine Adresse, das dauert ein paar
Sekunden:

```bash
virsh domifaddr k3s                              # ipv4 192.168.122.y/24
ssh admin@192.168.122.y
```

In der VM prüfen, ob cloud-init durch ist und alles passt:

```bash
cloud-init status --wait                         # status: done
hostname                                         # k3s
df -h /                                          # ca. 30G
free -h                                          # Swap: 0B
```

**Kein Swap** ist hier gewollt: Kubernetes plant Pods anhand ihres RAM-Bedarfs ein und erwartet,
dass dieser RAM wirklich vorhanden ist. Mit Swap würde ein Knoten unter Last unbemerkt auslagern,
statt Pods zu verdrängen. Das Cloud-Image hat keinen Swap, anders als eine Installation mit dem
Debian-Installer (dort `swapoff -a` und die Swap-Zeile in `/etc/fstab` auskommentieren).

Im Folgenden steht `192.168.122.y` für die IP dieser VM.

Nützlich für später (auf dem Host, mit `LIBVIRT_DEFAULT_URI` wie oben):

```bash
virsh shutdown k3s                               # herunterfahren
virsh start k3s                                  # starten
virsh autostart k3s                              # mit dem Host starten (optional)
virsh console k3s                                # serielle Konsole, falls SSH nicht geht (Strg+] beendet)
virsh destroy k3s && virsh undefine k3s --remove-all-storage   # VM samt Disk weg
```

## 2. k3s installieren

In der VM als `admin`:

```bash
# curl hat cloud-init schon installiert
curl -sfL https://get.k3s.io | sh -
```

Das Skript lädt das k3s-Binary (Kanal `stable`), richtet den systemd-Dienst `k3s` ein und legt
`kubectl` als Link auf k3s an. Prüfen:

```bash
sudo systemctl status k3s          # active (running)
sudo kubectl get nodes             # k3s   Ready   control-plane,master   …   v1.xx.x+k3s1
sudo kubectl get pods -A           # coredns, traefik, metrics-server, local-path-provisioner,
                                   # svclb-traefik: Running; helm-install-traefik*: Completed
```

Die k3s-Version aus `get nodes` bitte notieren: Damit wissen wir, welche Kubernetes-Version
das Chart mindestens unterstützen muss.

Traefik antwortet schon auf Port 80, hat aber noch keine Routen. Vom Host aus:

```bash
curl -i http://192.168.122.y/      # HTTP/1.1 404 Not Found, "404 page not found" von Traefik
```

## 3. Zugriff vom Host

`kubectl` braucht eine **kubeconfig**: Adresse der API, das CA-Zertifikat des Clusters und
Zugangsdaten. k3s schreibt eine nach `/etc/rancher/k3s/k3s.yaml`. Deren Zugangsdaten sind
**cluster-admin**, also volle Rechte auf den Cluster: Datei wie ein Passwort behandeln.

In der VM eine Kopie für `admin` lesbar machen:

```bash
sudo install -m 600 -o admin -g admin /etc/rancher/k3s/k3s.yaml ~/k3s.yaml
```

Auf dem Host `kubectl` und `helm` installieren und die Datei holen. Auf Bluefin kommen
Kommandozeilen-Werkzeuge über Homebrew (nach `/home/linuxbrew`, ohne Neustart), nicht per
`rpm-ostree install` ins System-Image. Vielleicht sind sie auch schon da:

```bash
command -v kubectl helm || brew install kubectl helm

mkdir -p ~/.kube
scp admin@192.168.122.y:k3s.yaml ~/.kube/cloudpoc-k3s.yaml
chmod 600 ~/.kube/cloudpoc-k3s.yaml
ssh admin@192.168.122.y rm k3s.yaml

# Die Datei zeigt auf 127.0.0.1 (aus Sicht der VM), vom Host aus ist es die VM-IP.
# Das Zertifikat der API gilt auch für die IP der VM, k3s trägt sie selbst ein.
sed -i 's/127.0.0.1/192.168.122.y/' ~/.kube/cloudpoc-k3s.yaml
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
