.PHONY: install lint eslint prettier build webpack

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

build: build compile

webpack:
	npx webpack --mode production

deploy: install build
	node --no-warnings ./dist/deploy.cjs deploy

delete: install build
	node --no-warnings ./dist/deploy.cjs delete
