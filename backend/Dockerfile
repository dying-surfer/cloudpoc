# Prod-Image des Backends: Symfony auf FrankenPHP (PHP + Caddy in einem Binary).
# Bauen (auf dem Host): make backend-image
#
# Multi-Stage-Build: In "build" laufen Composer und der Cache-Warmup. Ins fertige
# Image ("prod") kommt nur das Ergebnis, ohne Composer und Build-Werkzeuge.

# --- base: Laufzeit, gemeinsam für beide Stufen ------------------------------
FROM docker.io/dunglas/frankenphp:1-php8.4 AS base

WORKDIR /app

# Nur die Extensions, die die App zur Laufzeit braucht
RUN install-php-extensions pdo_pgsql intl opcache \
    && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"
COPY docker/php.prod.ini $PHP_INI_DIR/conf.d/zz-app.ini

ENV APP_ENV=prod

# --- build: Abhängigkeiten installieren, Cache vorwärmen -----------------------
FROM base AS build

# zip braucht nur Composer zum Entpacken der Pakete
RUN install-php-extensions zip
COPY --from=docker.io/library/composer:2 /usr/bin/composer /usr/local/bin/composer
ENV COMPOSER_ALLOW_SUPERUSER=1

# Erst nur die Lock-Dateien kopieren und installieren: Diese Schicht bleibt im
# Build-Cache, solange sich die Abhängigkeiten nicht ändern. Code-Änderungen
# lösen dann kein neues `composer install` aus.
COPY composer.json composer.lock symfony.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-progress

# Jetzt den Code (was nicht hineingehört, filtert .dockerignore)
COPY . .

# - dump-autoload: Classmap für alle Klassen, keine Dateisuche zur Laufzeit
# - dump-env: .env-Dateien in .env.local.php vorkompilieren (echte Env-Vars gewinnen weiterhin)
# - cache:warmup: Container, Routen usw. einmal beim Build erzeugen statt beim ersten Request
RUN composer dump-autoload --no-dev --classmap-authoritative \
    && composer dump-env prod \
    && php bin/console cache:warmup

# --- prod: das fertige Image ---------------------------------------------------
FROM base AS prod

# SERVER_NAME ":8080": nur HTTP auf Port 8080, ohne automatisches HTTPS.
# TLS übernimmt der Reverse Proxy davor. Ports über 1024 brauchen kein root.
ENV SERVER_NAME=:8080

# Unprivilegierter User. setcap -r entfernt die Datei-Capability zum Binden an
# Port 80/443: Wir brauchen sie nicht, und unter Kubernetes mit
# "drop: ALL" würde das Binary mit ihr gar nicht erst starten.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin app \
    && setcap -r /usr/local/bin/frankenphp \
    && chown -R app:app /config/caddy /data/caddy

# Code gehört root und ist für die App nur lesbar; schreiben darf sie nur in var/
COPY --from=build /app /app
RUN chown -R app:app /app/var

USER app
EXPOSE 8080
