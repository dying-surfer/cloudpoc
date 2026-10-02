{{/*
Gemeinsame Bausteine für die Templates. Dateien mit "_" am Anfang erzeugen
selbst keine Kubernetes-Objekte.
*/}}

{{/* Präfix für alle Objektnamen: der Release-Name (helm install <release> …) */}}
{{- define "cloudpoc.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Labels an allen Objekten (Kubernetes-Empfehlung app.kubernetes.io/*) */}}
{{- define "cloudpoc.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | trunc 12 | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Selector-Labels: Damit findet ein Deployment seine Pods und ein Service seine
Endpunkte. Dürfen sich nach dem ersten Install nicht mehr ändern (Kubernetes
lehnt geänderte Selektoren ab), deshalb ohne Version.
Aufruf: include "cloudpoc.selectorLabels" (dict "ctx" $ "component" "frontend")
*/}}
{{- define "cloudpoc.selectorLabels" -}}
app.kubernetes.io/name: {{ .ctx.Chart.Name }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Vollständige Image-Referenz, bricht ohne image.tag ab */}}
{{- define "cloudpoc.image" -}}
{{- printf "%s/cloudpoc-%s:%s" .ctx.Values.image.registry .component (required "image.tag fehlt: voller Commit-SHA, z. B. --set image.tag=$(git rev-parse origin/main)" .ctx.Values.image.tag) -}}
{{- end -}}

{{/* Sicherheitseinstellungen für alle Container: kein root, keine Rechte-Ausweitung */}}
{{- define "cloudpoc.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end -}}
