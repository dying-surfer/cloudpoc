# Entwicklungs-Image für den Service "workspace".
# Enthält alle Werkzeuge für Backend und Frontend – NICHT das Prod-Image (das kommt in M4).
FROM php:8.4-cli

ARG NODE_MAJOR=24
ARG USERNAME=dev
ARG USER_UID=1000
ARG USER_GID=1000

# System-Pakete: Git, psql (Client passend zu Postgres 17), Tools für Composer
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git unzip curl ca-certificates sudo bash-completion postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# PHP-Extensions: Postgres-Treiber, Intl (Symfony), Zip (Composer), Opcache
COPY --from=docker.io/mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/
RUN install-php-extensions pdo_pgsql intl zip opcache \
    && cp "$PHP_INI_DIR/php.ini-development" "$PHP_INI_DIR/php.ini"

# Composer und Symfony CLI als fertige Binaries aus ihren offiziellen Images
COPY --from=docker.io/library/composer:2 /usr/bin/composer /usr/local/bin/composer
COPY --from=ghcr.io/symfony-cli/symfony-cli:latest /usr/local/bin/symfony /usr/local/bin/symfony

# Node LTS aus dem offiziellen Node-Image übernehmen
COPY --from=docker.io/library/node:${NODE_MAJOR}-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=docker.io/library/node:${NODE_MAJOR}-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Unprivilegierter User mit derselben UID wie auf dem Host (siehe userns_mode in compose.yaml)
RUN groupadd --gid ${USER_GID} ${USERNAME} \
    && useradd --uid ${USER_UID} --gid ${USER_GID} --create-home --shell /bin/bash ${USERNAME} \
    && echo "${USERNAME} ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME}

USER ${USERNAME}
