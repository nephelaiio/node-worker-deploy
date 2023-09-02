.PHONY: install lint eslint prettier build webpack test version run deploy delete

install:
	npm ci

lint: prettier eslint

prettier: install
	npx prettier --plugin-search-dir . --check .

eslint: install
	npx eslint .

format: install
	npx prettier --plugin-search-dir . --write .
	npx eslint . --fix

build: install webpack

webpack:
	npx webpack --mode production

test:
	npx vitest run

version: install build
	node --no-warnings ./dist/deploy.cjs --version

run:
	node --no-warnings ./dist/deploy.cjs $(filter-out run,$(MAKECMDGOALS))

deploy: install build
	node --no-warnings ./dist/deploy.cjs deploy $(filter-out $(TARGETS),$(MAKECMDGOALS))

delete: install build
	node --no-warnings ./dist/deploy.cjs delete $(filter-out $(TARGETS),$(MAKECMDGOALS))

%:
	@:
