# Einheitliche Entry-Points für Dev, CI und Deployments.
# `make` ohne Ziel zeigt alle Targets mit ihrer Beschreibung (## Kommentar).

.DEFAULT_GOAL := help
.PHONY: help

help: ## Diese Hilfe anzeigen
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# --- Devcontainer (vom Host aus; in VS Code: "Reopen in Container") ----------

DEVCONTAINER = devcontainer --workspace-folder . --docker-path podman --docker-compose-path docker-compose
DEV_COMPOSE  = podman compose -f .devcontainer/compose.yaml

# Unterdrückt Podmans Hinweis ">>>> Executing external compose provider ..."
export PODMAN_COMPOSE_WARNING_LOGS = false

.PHONY: dev-up dev-shell dev-psql dev-down

dev-up: ## Devcontainer bauen und starten
	@$(DEVCONTAINER) up

dev-shell: ## Shell im Devcontainer öffnen
	@$(DEV_COMPOSE) exec workspace bash

dev-psql: ## psql im Devcontainer gegen die Wegwerf-DB öffnen
	@$(DEV_COMPOSE) exec workspace psql

dev-down: ## Devcontainer stoppen und entfernen (DB-Inhalt ist danach weg)
	@$(DEV_COMPOSE) down

# --- Backend (läuft im Devcontainer) -----------------------------------------
# Auf dem Host (mit podman) laufen die Befehle per `exec` im Devcontainer, sonst
# (im Devcontainer selbst, später in CI) direkt im Ordner backend/.

ifneq ($(shell command -v podman 2>/dev/null),)
BACKEND = $(DEV_COMPOSE) exec -w /workspaces/cloudpoc/backend workspace
else
BACKEND = cd backend &&
endif

.PHONY: backend-install backend-check backend-fixtures test

backend-install: ## Composer-Abhängigkeiten des Backends installieren
	@$(BACKEND) composer install

backend-fixtures: ## Dev-DB migrieren und mit 200 Demo-Tickets füllen (löscht alle Daten)
	@$(BACKEND) php bin/console doctrine:migrations:migrate -n
	@$(BACKEND) php bin/console doctrine:fixtures:load -n

backend-check: ## Backend: Code-Style, PHPStan, PHPUnit (gegen die Test-DB)
	@$(BACKEND) composer check

# --- Frontend (läuft im Devcontainer) ----------------------------------------
# Gleiches Muster wie beim Backend, nur im Ordner frontend/.

ifneq ($(shell command -v podman 2>/dev/null),)
FRONTEND = $(DEV_COMPOSE) exec -w /workspaces/cloudpoc/frontend workspace
else
FRONTEND = cd frontend &&
endif

.PHONY: frontend-install frontend-check

frontend-install: ## npm-Abhängigkeiten des Frontends installieren (exakt nach Lockfile)
	@$(FRONTEND) npm ci

frontend-check: ## Frontend: Prettier, ESLint, Vitest, Produktions-Build
	@$(FRONTEND) npm run check

# --- Alles ---------------------------------------------------------------------

test: backend-check frontend-check ## Alle Checks und Tests (Backend und Frontend)
