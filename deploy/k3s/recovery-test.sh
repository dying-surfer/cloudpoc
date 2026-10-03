#!/usr/bin/env bash
# Point-in-Time-Recovery prüfen (docs/k8s.md, Abschnitt 12): setzt in der Quell-DB eine
# Marke vor und eine nach einem Zeitpunkt, baut dann in einem neuen Namespace die App
# samt Datenbank aus dem Backup auf diesen Zeitpunkt auf und sieht nach, ob genau die
# erste Marke da ist. Auf dem Host mit der Admin-kubeconfig (legt einen Namespace an):
#   deploy/k3s/recovery-test.sh [quell-namespace] [ziel-namespace]
# Der Ziel-Namespace bleibt zum Ansehen stehen. Aufräumen: kubectl delete namespace <ziel>
set -euo pipefail
cd "$(dirname "$0")/../.."

SRC=${1:-cloudpoc-staging}
DST=${2:-cloudpoc-restore}
# Adresse des Ingress und Hostname der wiederhergestellten App. Den Namen muss kein DNS
# kennen: curl schickt ihn als Host-Header mit, Traefik wählt danach die Route.
BASE=${BASE:-http://192.168.122.51}
HOST=${HOST:-restore.cloudpoc.test}
CLUSTER=cloudpoc-db

# SQL als Superuser im Primary eines Namespace ausführen, Ergebnis ohne Rahmen
sql() {
  local pod
  pod=$(kubectl get pods -n "$1" -o name \
    -l "cnpg.io/cluster=$CLUSTER,cnpg.io/instanceRole=primary")
  kubectl exec -n "$1" "$pod" -c postgres -- psql -U postgres -d app -AtXq -c "$2"
}

if kubectl get namespace "$DST" > /dev/null 2>&1; then
  echo "Namespace $DST gibt es schon. Erst aufräumen: kubectl delete namespace $DST" >&2
  exit 1
fi

# Die Test-Tabelle verschwindet am Ende wieder aus der Quelle, auch bei einem Fehler
trap 'sql "$SRC" "drop table if exists pitr_test" || true' EXIT

echo "== Marken in $SRC setzen"
sql "$SRC" "drop table if exists pitr_test; create table pitr_test (note text, at timestamptz default now())"
sql "$SRC" "insert into pitr_test (note) values ('vorher')"
sleep 3
# Zeit der Datenbank, nicht des Hosts: Die Uhren müssen nicht gleich gehen
target=$(sql "$SRC" "select to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
sleep 3
sql "$SRC" "insert into pitr_test (note) values ('nachher')"
sql "$SRC" "select note, at from pitr_test order by at"
echo "Zielzeitpunkt: $target (zwischen den beiden Marken)"

# Die zweite Marke steht noch in der angefangenen WAL-Datei. pg_switch_wal schließt sie
# ab, damit sie ins Archiv geht: Die Recovery braucht WAL bis hinter den Zielzeitpunkt.
echo "== Warten, bis das WAL-Archiv den Zielzeitpunkt abdeckt"
wal=$(sql "$SRC" "select pg_walfile_name(pg_switch_wal())")
for _ in $(seq 60); do
  [ "$(sql "$SRC" "select coalesce(last_archived_wal >= '$wal', false) from pg_stat_archiver")" = t ] && break
  sleep 2
done
sql "$SRC" "select 'archiviert bis ' || last_archived_wal || ', gebraucht ' || '$wal' from pg_stat_archiver"
[ "$(sql "$SRC" "select coalesce(last_archived_wal >= '$wal', false) from pg_stat_archiver")" = t ] \
  || { echo "FEHLER: $wal ist nach 2 Minuten nicht archiviert" >&2; exit 1; }

echo "== Namespace $DST mit den Secrets aus $SRC"
kubectl create namespace "$DST"
for s in ghcr-pull cloudpoc-backend cloudpoc-s3; do
  kubectl get secret "$s" -n "$SRC" -o json \
    | jq '{apiVersion, kind, type, data, metadata: {name: .metadata.name}}' \
    | kubectl apply -n "$DST" -f -
done

# Dieselbe Version und dieselben Werte wie die Quelle, nur: eigener Hostname, DB aus dem
# Backup, und keine eigenen Backups (ein Wegwerf-Namespace soll kein Archiv hinterlassen).
echo "== App in $DST ausrollen, DB aus dem Backup von $SRC"
tag=$(helm get values cloudpoc -n "$SRC" -o json | jq -r .image.tag)
helm upgrade --install cloudpoc deploy/helm/cloudpoc -n "$DST" \
  -f "deploy/helm/values/$SRC.yaml" --set image.tag="$tag" \
  --set ingress.host="$HOST" \
  --set db.cnpg.backup.enabled=false \
  --set db.cnpg.recovery.enabled=true \
  --set db.cnpg.recovery.sourceNamespace="$SRC" \
  --set db.cnpg.recovery.targetTime="$target" \
  --wait --timeout 10m \
  || { echo "== Rollout gescheitert, Stand:"; kubectl get cluster,pods,jobs -n "$DST"; exit 1; }

echo "== Ergebnis"
kubectl get cluster,pods -n "$DST"
notes=$(sql "$DST" "select string_agg(note, ',' order by at) from pitr_test")
code=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' -H "Host: $HOST" "$BASE/api/tickets" || true)
echo "Marken in $DST:   $notes (erwartet: vorher)"
echo "Tickets in $DST:  $(sql "$DST" "select count(*) from ticket")"
echo "GET /api/tickets: $code (erwartet: 200)"

if [ "$notes" = vorher ] && [ "$code" = 200 ]; then
  echo "== Recovery auf $target erfolgreich"
  echo "Ansehen:   curl -H 'Host: $HOST' $BASE/api/tickets"
  echo "Aufräumen: kubectl delete namespace $DST"
  exit 0
fi
echo "== FEHLER: Recovery passt nicht zum Zielzeitpunkt oder die App antwortet nicht" >&2
exit 1
