# Prod-Image des Frontends: Angular-Build, ausgeliefert von nginx.
# Bauen (auf dem Host): make frontend-image
#
# Multi-Stage-Build: Node braucht es nur zum Bauen. Ins fertige Image kommen nur
# die statischen Dateien und ein nginx, der als non-root auf Port 8080 läuft.

# --- build: Angular bauen -------------------------------------------------------
FROM docker.io/library/node:26-slim AS build

WORKDIR /app

# Wie beim Backend: erst nur die Lock-Dateien, damit `npm ci` im Build-Cache
# bleibt, solange sich die Abhängigkeiten nicht ändern
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# config.json kommt NICHT ins Image: Sie wird pro Umgebung von außen eingehängt
# (Compose-Mount, später ConfigMap). Fehlt sie, startet die App absichtlich nicht.
RUN npx ng build \
    && rm dist/cloudpoc/browser/config.json

# --- prod: nginx mit den fertigen Dateien ----------------------------------------
# nginx-unprivileged läuft als User nginx (UID 101) und lauscht auf 8080
FROM docker.io/nginxinc/nginx-unprivileged:stable-alpine AS prod

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# Dateien gehören root, nginx darf sie nur lesen
COPY --from=build /app/dist/cloudpoc/browser /usr/share/nginx/html

EXPOSE 8080
