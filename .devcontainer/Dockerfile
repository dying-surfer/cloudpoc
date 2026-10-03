# Entwicklungs-Image für den Service "workspace".
# Enthält alle Werkzeuge für Backend und Frontend – NICHT das Prod-Image (das kommt in M4).
FROM php:8.5-cli

ARG NODE_MAJOR=24
ARG USERNAME=dev
ARG USER_UID=1000
ARG USER_GID=1000

# System-Pakete: Git, psql (Client passend zu Postgres 17), Tools für Composer
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git unzip curl ca-certificates sudo bash-completion postgresql-client locales \
    && rm -rf /var/lib/apt/lists/*

# Locales: VS Code reicht die Host-Locale (z. B. de_DE.UTF-8) in den Container durch.
# Fehlt sie, warnen perl & Co. mit "Setting locale failed".
RUN sed -i -E 's/^# (de_DE|en_US)\.UTF-8 UTF-8/\1.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen
ENV LANG=en_US.UTF-8

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

# Helm und kubeconform zum Prüfen des Helm-Charts (make helm-check), Versionen wie in CI.
# Release-Archive von GitHub/get.helm.sh, gegen die veröffentlichten Prüfsummen geprüft.
ARG HELM_VERSION=4.3.0
ARG KUBECONFORM_VERSION=0.8.0
RUN set -e; arch=$(dpkg --print-architecture); cd /tmp \
    && curl -fsSLO https://get.helm.sh/helm-v${HELM_VERSION}-linux-${arch}.tar.gz \
    && curl -fsSL https://get.helm.sh/helm-v${HELM_VERSION}-linux-${arch}.tar.gz.sha256sum | sha256sum -c - \
    && tar xzf helm-v${HELM_VERSION}-linux-${arch}.tar.gz --strip-components=1 -C /usr/local/bin linux-${arch}/helm \
    && curl -fsSLO https://github.com/yannh/kubeconform/releases/download/v${KUBECONFORM_VERSION}/kubeconform-linux-${arch}.tar.gz \
    && curl -fsSL https://github.com/yannh/kubeconform/releases/download/v${KUBECONFORM_VERSION}/CHECKSUMS | grep " kubeconform-linux-${arch}.tar.gz$" | sha256sum -c - \
    && tar xzf kubeconform-linux-${arch}.tar.gz -C /usr/local/bin kubeconform \
    && rm -f /tmp/*.tar.gz

# Unprivilegierter User mit derselben UID wie auf dem Host (siehe userns_mode in compose.yaml)
RUN groupadd --gid ${USER_GID} ${USERNAME} \
    && useradd --uid ${USER_UID} --gid ${USER_GID} --create-home --shell /bin/bash ${USERNAME} \
    && echo "${USERNAME} ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME}

USER ${USERNAME}

# Mountpunkt für das Volume claude-config: Ein neues Volume übernimmt beim ersten
# Mount Inhalt und Besitzer dieses Verzeichnisses – so gehört es dev statt root.
RUN mkdir -p /home/${USERNAME}/.claude
