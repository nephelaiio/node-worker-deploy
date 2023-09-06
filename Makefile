.PHONY: install lint eslint prettier build webpack test version run

BUNDLE=./dist/deploy.cjs

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

test: build
	npx vitest run

version: install build
	node --no-warnings ${BUNDLE} --version

run:
	@node --no-warnings ${BUNDLE} $(filter-out run,$(MAKECMDGOALS))

%:
	@:
