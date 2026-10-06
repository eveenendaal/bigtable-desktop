# Common local tasks. Run `make` (or `make help`) to list them.

EMULATOR_PORT ?= 8086
export EMULATOR_PORT
WITH_EMULATOR := scripts/with-emulator.sh
MAC_ARCH := $(shell uname -m | sed 's/x86_64/x64/')
MAC_APP_DIR := dist/mac$(if $(filter arm64,$(MAC_ARCH)),-arm64,)

.DEFAULT_GOAL := help
.PHONY: help install start test test-emulator emulator seed demo dist package-mac install-mac clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

install: node_modules ## Install dependencies

start: node_modules ## Run the app from source
	npm start

test: node_modules ## Run unit tests
	npm test

test-emulator: node_modules ## Run all tests, including emulator integration tests
	$(WITH_EMULATOR) npm test

emulator: ## Run the Bigtable emulator in the foreground
	$(WITH_EMULATOR)

seed: node_modules ## Load sample data into a running emulator
	BIGTABLE_EMULATOR_HOST=localhost:$(EMULATOR_PORT) npm run seed:emulator

demo: node_modules ## Start an emulator, load sample data and run the app
	@echo "In the app, add project demo-project with emulator host localhost:$(EMULATOR_PORT), then instance demo-instance."
	$(WITH_EMULATOR) sh -c 'npm run seed:emulator && npm start'

dist: node_modules ## Build installers for the current platform into dist/
	npx electron-builder --publish never

package-mac: node_modules ## Build macOS DMG/ZIP for arm64 and x64 into dist/
	npx electron-builder --mac --arm64 --x64 --publish never

install-mac: node_modules ## Build for this Mac and copy the app to /Applications
	npx electron-builder --mac dir --$(MAC_ARCH) --publish never
	rm -rf "/Applications/Bigtable Desktop.app"
	cp -R "$(MAC_APP_DIR)/Bigtable Desktop.app" /Applications/
	@echo "Installed /Applications/Bigtable Desktop.app"

clean: ## Remove build output
	rm -rf dist
