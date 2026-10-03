#!/usr/bin/env bash
# Prüft das Helm-Chart ohne Cluster: helm lint und kubeconform (Schema-Prüfung der
# erzeugten Manifeste) für jede Werte-Kombination, die wir tatsächlich ausrollen.
# Aufruf: make helm-check (im Devcontainer und in CI).
set -euo pipefail
cd "$(dirname "$0")"

CHART=cloudpoc
# Gegen diese Kubernetes-Version (k3s in docs/k8s.md)
KUBE_VERSION=1.36.0
# Platzhalter für den Pflichtwert image.tag
TAG=0123456789abcdef0123456789abcdef01234567

# CRDs (z. B. der CNPG-Cluster) kennt kubeconform nicht von selbst: Schemas aus
# dem CRDs-Katalog von datree. -strict meldet Felder, die es im Schema nicht gibt.
KUBECONFORM=(kubeconform -strict -summary -kubernetes-version "$KUBE_VERSION"
  -schema-location default
  -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json')

check() {
  echo "== $1"
  shift
  helm lint --quiet "$CHART" --set image.tag="$TAG" "$@"
  helm template cloudpoc "$CHART" --set image.tag="$TAG" "$@" | "${KUBECONFORM[@]}"
}

check "Standard (staging)"
check "Prod" -f "$CHART/values-prod.yaml" --set db.cnpg.backup.bucket=cloudpoc-backups
check "Recreate" --set strategy=Recreate
check "Externe DB" --set db.mode=external --set db.external.existingSecret=cloudpoc-db
check "Recovery" -f values/cloudpoc-staging.yaml --set db.cnpg.backup.enabled=false \
  --set db.cnpg.recovery.enabled=true --set db.cnpg.recovery.sourceNamespace=cloudpoc-staging \
  --set db.cnpg.recovery.targetTime=2026-10-03T11:45:00Z

# Die Werte-Dateien pro Namespace (make k8s-deploy)
for f in values/*.yaml; do
  check "Namespace $(basename "$f" .yaml)" -f "$f"
done

# Ohne image.tag muss das Chart abbrechen (kein Deploy ohne genaue Version)
echo "== Ohne image.tag"
if helm template cloudpoc "$CHART" > /dev/null 2>&1; then
  echo "FEHLER: helm template ohne image.tag läuft durch" >&2
  exit 1
fi
echo "bricht wie gewollt ab"

# Backup eingeschaltet, aber kein Bucket: muss abbrechen
echo "== Backup ohne Bucket"
if helm template cloudpoc "$CHART" --set image.tag="$TAG" --set db.cnpg.backup.enabled=true > /dev/null 2>&1; then
  echo "FEHLER: helm template mit Backup ohne Bucket läuft durch" >&2
  exit 1
fi
echo "bricht wie gewollt ab"

# Recovery in den Namespace, aus dem die Backups stammen: muss abbrechen
echo "== Recovery in den eigenen Namespace"
if helm template cloudpoc "$CHART" -n cloudpoc-staging --set image.tag="$TAG" -f values/cloudpoc-staging.yaml \
  --set db.cnpg.recovery.enabled=true --set db.cnpg.recovery.sourceNamespace=cloudpoc-staging > /dev/null 2>&1; then
  echo "FEHLER: helm template mit Recovery in den eigenen Namespace läuft durch" >&2
  exit 1
fi
echo "bricht wie gewollt ab"
