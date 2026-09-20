# Thin wrapper over docker compose for the three services.
# Override the compose command if yours differs: make up COMPOSE="docker-compose"
COMPOSE ?= docker compose

.PHONY: help up down build rebuild logs ps clean

help: ## Show the available targets
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  %-9s %s\n", $$1, $$2}'

up: ## Build if needed and start everything in the background
	$(COMPOSE) up --build -d
	@echo "frontend  http://localhost:3000"
	@echo "solver    http://localhost:8080/health"
	@echo "detection http://localhost:8081/health"

down: ## Stop and remove the containers
	$(COMPOSE) down

build: ## Build the images without starting anything
	$(COMPOSE) build

rebuild: ## Rebuild from scratch, ignoring the layer cache
	$(COMPOSE) build --no-cache

logs: ## Follow the logs of all services
	$(COMPOSE) logs -f

ps: ## Show service status
	$(COMPOSE) ps

clean: ## Stop everything and delete the volumes
	$(COMPOSE) down -v
