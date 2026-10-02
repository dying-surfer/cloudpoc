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

{{/* Sicherheitseinstellungen für alle Container: keine Rechte-Ausweitung, keine Capabilities */}}
{{- define "cloudpoc.containerSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: [ALL]
{{- end -}}

{{/* Name des CNPG-Clusters; der Operator leitet daraus Services (-rw) und Secrets (-app) ab */}}
{{- define "cloudpoc.dbCluster" -}}
{{ include "cloudpoc.fullname" . }}-db
{{- end -}}

{{/*
Env-Variablen des Backends, gemeinsam für Deployment und Migrations-Job
(wie der YAML-Anker x-backend im Compose-Stack).
*/}}
{{- define "cloudpoc.backendEnv" -}}
- name: APP_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ required "backend.existingSecret fehlt" .Values.backend.existingSecret }}
      key: APP_SECRET
{{- if eq .Values.db.mode "cnpg" }}
# Passwort aus dem Secret, das der Operator anlegt. $(DB_PASSWORD) in der
# nächsten Variable setzt Kubernetes selbst ein (nur für weiter oben
# definierte Variablen). Host: der Service <cluster>-rw zeigt immer auf
# den Primary.
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "cloudpoc.dbCluster" . }}-app
      key: password
- name: DATABASE_URL
  value: postgresql://app:$(DB_PASSWORD)@{{ include "cloudpoc.dbCluster" . }}-rw:5432/app?serverVersion=17&charset=utf8
{{- else }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ required "db.external.existingSecret fehlt" .Values.db.external.existingSecret }}
      key: DATABASE_URL
{{- end }}
{{- end -}}
