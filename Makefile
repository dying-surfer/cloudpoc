# Einheitliche Entry-Points für Dev, CI und Deployments.
# `make` ohne Ziel zeigt alle Targets mit ihrer Beschreibung (## Kommentar).

.DEFAULT_GOAL := help
.PHONY: help

help: ## Diese Hilfe anzeigen
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
