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

# Checks laufen im Devcontainer: auf dem Host (podman vorhanden) per `exec` dorthin,
# sonst direkt (im Devcontainer selbst). In CI (GitHub setzt CI=true) ist podman zwar
# installiert, aber es gibt keinen Devcontainer: dort ebenfalls direkt.
USE_DEVCONTAINER := $(if $(CI),,$(shell command -v podman 2>/dev/null))

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

ifneq ($(USE_DEVCONTAINER),)
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

ifneq ($(USE_DEVCONTAINER),)
FRONTEND = $(DEV_COMPOSE) exec -w /workspaces/cloudpoc/frontend workspace
else
FRONTEND = cd frontend &&
endif

.PHONY: frontend-install frontend-check

frontend-install: ## npm-Abhängigkeiten des Frontends installieren (exakt nach Lockfile)
	@$(FRONTEND) npm ci

frontend-check: ## Frontend: Prettier, ESLint, Vitest, Produktions-Build
	@$(FRONTEND) npm run check

# --- Prod-Images (auf dem Host mit podman, in CI mit docker) ------------------
# Lokal heißt der Tag "local"; in CI später der Git-SHA (make backend-image TAG=…).
# CONTAINER wählt das Werkzeug: lokal podman, in CI (GitHub-Runner) docker.

TAG       ?= local
CONTAINER ?= podman

.PHONY: backend-image frontend-image

backend-image: ## Prod-Image des Backends bauen (Tag per TAG=…, Standard: local)
	$(CONTAINER) build -t cloudpoc-backend:$(TAG) backend

frontend-image: ## Prod-Image des Frontends bauen (Tag per TAG=…, Standard: local)
	$(CONTAINER) build -t cloudpoc-frontend:$(TAG) frontend

# --- Prod-naher Stack (auf dem Host, in CI mit CONTAINER=docker) -----------------
# Nutzt die lokal gebauten Images; Secrets kommen aus deploy/compose/.env.
# Auf der VM liegt die .env außerhalb des Checkouts: ENV_FILE=/srv/cloudpoc/.env

ENV_FILE ?=
STACK = $(CONTAINER) compose -f deploy/compose/compose.yaml $(if $(ENV_FILE),--env-file $(ENV_FILE))

.PHONY: images stack-up stack-ps stack-logs stack-down stack-destroy deploy

images: backend-image frontend-image ## Beide Prod-Images bauen

stack-up: ## Stack starten (http://localhost:8088); vorher make images
	$(STACK) up -d

stack-ps: ## Status der Services im Stack
	$(STACK) ps -a

stack-logs: ## Logs aller Services verfolgen (Strg+C beendet)
	$(STACK) logs -f

stack-down: ## Stack stoppen und entfernen, die Daten (Volume) bleiben
	$(STACK) down

stack-destroy: ## Stack samt DB-Volume entfernen (alle Daten weg!)
	$(STACK) down -v

# Vom Deploy-Workflow auf der VM aufgerufen, Images per BACKEND_IMAGE/FRONTEND_IMAGE.
# `up -d` kehrt erst zurück, wenn migrate durch ist und backend/frontend healthy sind
# (depends_on mit condition), denn erst dann startet der proxy.
deploy: ## Images aus der Registry holen und Stack damit neu starten (VM)
	$(STACK) pull --quiet
	$(STACK) up -d --remove-orphans

# --- Smoke-Tests (Playwright, Ordner e2e/) ---------------------------------------
# stack-smoke läuft im offiziellen Playwright-Image: Browser und Systembibliotheken
# sind dort drin und passen exakt zur Version. Der Container hängt im Compose-Netz
# und spricht den Proxy direkt an. Die Version kommt aus e2e/package.json.
# e2e-check prüft nur statisch (Prettier, TypeScript, Testliste), geht also überall.

PLAYWRIGHT_VERSION := $(shell sed -n 's/.*"@playwright\/test": "\(.*\)".*/\1/p' e2e/package.json)
PLAYWRIGHT_IMAGE   = mcr.microsoft.com/playwright:v$(PLAYWRIGHT_VERSION)-noble

ifneq ($(USE_DEVCONTAINER),)
E2E = $(DEV_COMPOSE) exec -w /workspaces/cloudpoc/e2e workspace
else
E2E = cd e2e &&
endif

.PHONY: stack-smoke e2e-install e2e-check

stack-smoke: ## Playwright-Smoke-Tests gegen den laufenden Stack (Bericht: e2e/playwright-report/)
	$(CONTAINER) run --rm --init --ipc=host --network cloudpoc_default \
		-v $(CURDIR)/e2e:/e2e:z -w /e2e -e BASE_URL=http://proxy:8080 -e CI=1 \
		$(PLAYWRIGHT_IMAGE) sh -c 'npm ci --no-audit --no-fund && npx playwright test'

e2e-install: ## npm-Abhängigkeiten der Smoke-Tests installieren
	@$(E2E) npm ci

e2e-check: ## Smoke-Tests statisch prüfen: Prettier, TypeScript, Testliste
	@$(E2E) npm run check

# --- Datenbank des Stacks (nur auf dem Host) -------------------------------------
# Die Befehle laufen per exec im db-Container: Dort passen pg_dump/pg_restore immer
# zur Server-Version, und die DB braucht keinen veröffentlichten Port.
# Dumps landen in db/dumps/ (nicht im Repo, können echte Daten enthalten).
# Gefährliche Targets fragen nach; YES=1 überspringt die Frage (z. B. in Skripten).

DB_EXEC   = $(STACK) exec -T db
DUMP_DIR  = db/dumps
STAMP     := $(shell date +%Y%m%d-%H%M%S)
DUMP_FILE := $(DUMP_DIR)/cloudpoc-$(STAMP).dump
ANON_FILE := $(DUMP_DIR)/cloudpoc-anon-$(STAMP).dump

# $(call confirm,Text): fragt nach und bricht ab, wenn nicht mit "j" geantwortet wird
define confirm
	@if [ "$(YES)" != 1 ]; then printf '%s Weiter? [j/N] ' "$(1)"; read a; [ "$$a" = j ]; fi
endef

.PHONY: db-reset db-dump db-dump-anon db-import dev-db-import

db-reset: ## Stack-DB leeren und neu migrieren (alle Daten weg!)
	$(call confirm,Alle Daten in der Stack-DB werden gelöscht.)
	$(DB_EXEC) psql -U app -d app -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
	$(STACK) run --rm migrate

db-dump: ## Dump der Stack-DB nach db/dumps/ schreiben
	@mkdir -p $(DUMP_DIR)
	@# Erst in eine .tmp-Datei: Bricht pg_dump ab, bleibt kein halber Dump mit gültigem Namen liegen
	$(DB_EXEC) pg_dump -U app -d app --format=custom > $(DUMP_FILE).tmp
	@mv $(DUMP_FILE).tmp $(DUMP_FILE) && ls -lh $(DUMP_FILE)

db-import: ## Dump in die Stack-DB einspielen, ersetzt die Daten (FILE=db/dumps/….dump)
	@test -n "$(FILE)" || { echo "FILE fehlt, z. B.: make db-import FILE=db/dumps/cloudpoc-….dump"; exit 1; }
	$(call confirm,Die Daten in der Stack-DB werden durch $(FILE) ersetzt.)
	$(DB_EXEC) pg_restore -U app -d app --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error < $(FILE)
	@# Der Dump kann älter sein als der Code: fehlende Migrationen nachziehen
	$(STACK) run --rm migrate

db-dump-anon: ## Anonymisierten Dump der Stack-DB schreiben (für Dev/Staging)
	@mkdir -p $(DUMP_DIR)
	@# Kopie als anon_tmp anlegen; nur die Kopie wird anonymisiert. Die echten Daten
	@# verlassen den db-Container nie, nur der anonymisierte Dump.
	$(DB_EXEC) sh -c 'dropdb -U app --if-exists anon_tmp && createdb -U app anon_tmp \
		&& pg_dump -U app -d app --format=custom | pg_restore -U app -d anon_tmp --no-owner --no-acl --exit-on-error'
	$(DB_EXEC) psql -U app -d anon_tmp -q < db/anonymize.sql
	$(DB_EXEC) pg_dump -U app -d anon_tmp --format=custom > $(ANON_FILE).tmp
	$(DB_EXEC) dropdb -U app anon_tmp
	@mv $(ANON_FILE).tmp $(ANON_FILE) && ls -lh $(ANON_FILE)

# --- Datenbank im Devcontainer -----------------------------------------------------
# Auf dem Host per exec im workspace, im Devcontainer direkt (psql & Co. nutzen PGHOST usw.).

ifneq ($(USE_DEVCONTAINER),)
WORKSPACE = $(DEV_COMPOSE) exec -T -w /workspaces/cloudpoc workspace
else
WORKSPACE =
endif

dev-db-import: ## Anonymisierten Dump in die Dev-DB einspielen (FILE=db/dumps/cloudpoc-anon-….dump)
	@test -n "$(FILE)" || { echo "FILE fehlt, z. B.: make dev-db-import FILE=db/dumps/cloudpoc-anon-….dump"; exit 1; }
	@# Keine echten Daten in Dev: nur Dumps aus db-dump-anon (erkennbar am Namen)
	@case "$(notdir $(FILE))" in *-anon-*) ;; *) echo "$(FILE) ist kein anonymisierter Dump (*-anon-*). Erst make db-dump-anon."; exit 1;; esac
	$(WORKSPACE) pg_restore -d app --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error $(FILE)
	$(BACKEND) php bin/console doctrine:migrations:migrate -n

# --- Helm-Chart (deploy/helm/) --------------------------------------------------
# Prüft ohne Cluster (lint + kubeconform), läuft wie die anderen Checks im
# Devcontainer. helm und kubeconform bringt dessen Image mit.

ifneq ($(USE_DEVCONTAINER),)
HELM_CHECK = $(DEV_COMPOSE) exec -w /workspaces/cloudpoc workspace deploy/helm/check.sh
else
HELM_CHECK = deploy/helm/check.sh
endif

.PHONY: helm-check

helm-check: ## Helm-Chart prüfen: helm lint, kubeconform (alle Werte-Varianten)
	@$(HELM_CHECK)

# --- Kubernetes-Secrets (deploy/secrets/, mit sops verschlüsselt) ----------------
# Ein Unterordner pro Namespace. Anwenden nur auf dem Host: braucht sops mit dem
# privaten age-Schlüssel und kubectl mit KUBECONFIG (docs/k8s.md).

.PHONY: secrets-check k8s-secrets k8s-deploy

secrets-check: ## Prüfen, dass alle Secrets unter deploy/secrets/ verschlüsselt sind
	@deploy/check-secrets.sh

k8s-secrets: ## Secrets eines Namespace entschlüsseln und anwenden (Host, NS=cloudpoc-staging)
	@test -n "$(NS)" || { echo "NS fehlt, z. B. make k8s-secrets NS=cloudpoc-staging" >&2; exit 1; }
	@for f in deploy/secrets/$(NS)/*.sops.yaml; do \
		sops -d "$$f" | kubectl apply -f - || exit 1; \
	done

# Alle Werte kommen aus dem Repo (Chart-Defaults + deploy/helm/values/<NS>.yaml), nichts
# aus dem vorigen Release: deshalb weder --reuse-values noch --reset-then-reuse-values.
k8s-deploy: ## Version in einen Namespace ausrollen: Secrets, dann helm upgrade (Host, NS=cloudpoc-staging TAG=<SHA>)
	@test -n "$(NS)" || { echo "NS fehlt, z. B. make k8s-deploy NS=cloudpoc-staging TAG=<SHA>" >&2; exit 1; }
	@echo "$(TAG)" | grep -Eq '^[0-9a-f]{40}$$' || { echo "TAG muss ein voller Commit-SHA sein (ist: $(TAG)), z. B. TAG=\$$(git rev-parse origin/main)" >&2; exit 1; }
	@test -f deploy/helm/values/$(NS).yaml || { echo "deploy/helm/values/$(NS).yaml fehlt" >&2; exit 1; }
	@$(MAKE) --no-print-directory k8s-secrets NS=$(NS)
	helm upgrade --install cloudpoc deploy/helm/cloudpoc -n $(NS) \
		-f deploy/helm/values/$(NS).yaml --set image.tag=$(TAG) --wait --timeout 5m

# --- Alles ---------------------------------------------------------------------

test: backend-check frontend-check e2e-check helm-check secrets-check ## Alle Checks und Tests (Backend, Frontend, Smoke-Tests statisch, Helm-Chart, Secrets)
