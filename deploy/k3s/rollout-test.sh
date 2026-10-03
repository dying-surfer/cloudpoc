#!/usr/bin/env bash
# Rolling Update unter Last messen (docs/k8s.md, Abschnitt 8): schickt gleichmäßig
# Requests, tauscht währenddessen alle Pods der App aus und zeigt danach, welche
# Requests nicht 200 waren und was Traefik und Kubernetes dazu protokolliert haben.
# Auf dem Host mit der Admin-kubeconfig (die Traefik-Logs liegen in kube-system):
#   deploy/k3s/rollout-test.sh [namespace] [url]
set -euo pipefail

NS=${1:-cloudpoc-staging}
URL=${2:-http://192.168.122.51/api/tickets}
# Requests pro Sekunde. Jeder läuft für sich im Hintergrund: Ein hängender Request
# hält die anderen nicht auf (eine einfache Schleife stünde so lange still).
RATE=10
# So lange nach dem Rollout weitermessen: Die alten Pods beenden sich dann erst
AFTER=${AFTER:-15}

out=$(mktemp)
trap 'rm -f "$out"' EXIT
path=/${URL#*://*/}

pods() {
  kubectl get pods -n "$NS" \
    -o custom-columns=POD:.metadata.name,IP:.status.podIP,READY:.status.containerStatuses[0].ready,START:.status.startTime
}

load() {
  while true; do
    (
      start=$(date -u +%T.%3N)
      result=$(curl -s -o /dev/null --max-time 60 -w '%{http_code} %{time_total}' "$URL" || true)
      echo "$start $result" >> "$out"
    ) &
    sleep "$(awk "BEGIN { print 1 / $RATE }")"
  done
}

echo "== Pods vorher"
pods
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)

load &
load_pid=$!
sleep 5

echo "== Rollout ($RATE Requests/s auf $URL)"
kubectl rollout restart deployment -n "$NS"
for d in $(kubectl get deployment -n "$NS" -o name); do
  kubectl rollout status "$d" -n "$NS" --timeout 5m
done
sleep "$AFTER"

# Schleife beenden, dann warten, bis kein curl mehr unterwegs ist (höchstens --max-time)
kill "$load_pid" 2> /dev/null || true
wait 2> /dev/null || true

echo "== Pods nachher"
pods

echo "== Statuscodes (Anzahl, Code; 000 = keine Antwort)"
awk '{ print $2 }' "$out" | sort | uniq -c

failed=$(awk '$2 != 200' "$out" | sort)
if [ -z "$failed" ]; then
  echo "== Alle Requests 200"
  exit 0
fi

echo "== Nicht 200 (Start in UTC, Code, Dauer in s)"
echo "$failed"

# Vorletzte Angabe = Pod, an den Traefik den Request geschickt hat, letzte = Dauer
echo "== Traefik-Access-Log dazu"
kubectl logs -n kube-system deploy/traefik --since-time "$since" \
  | grep -F "\"GET $path " | grep -v '" 200 ' \
  || echo "(nichts gefunden oder kein Zugriff auf kube-system: Admin-kubeconfig nötig)"

echo "== Pod-Events (UTC)"
kubectl get events -n "$NS" --field-selector involvedObject.kind=Pod --sort-by=.lastTimestamp \
  -o custom-columns=TIME:.lastTimestamp,POD:.involvedObject.name,REASON:.reason,MESSAGE:.message \
  | tail -n 40
exit 1
