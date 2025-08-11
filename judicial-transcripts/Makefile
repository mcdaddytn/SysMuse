.PHONY: help install setup clean test build run docker-up docker-down

help:
	@echo "Available commands:"
	@echo "  make install        - Install dependencies"
	@echo "  make setup          - Complete setup (docker, db, seed)"
	@echo "  make test           - Run tests"
	@echo "  make build          - Build TypeScript"
	@echo "  make run            - Start the API server"
	@echo "  make clean          - Clean build and temp files"
	@echo "  make docker-up      - Start Docker services"
	@echo "  make docker-down    - Stop Docker services"
	@echo "  make sync-es        - Sync statements to Elasticsearch"
	@echo "  make search FILE=<path> - Execute single search query"
	@echo "  make search-batch   - Execute all queries in config/queries/"
	@echo "  make test-search    - Run all test queries"
	@echo "  make search-examples - Generate example query files"

install:
	npm install

setup:
	./scripts/setup.sh

test:
	npm test

build:
	npm run build

run:
	npm start

clean:
	rm -rf dist/
	rm -rf coverage/
	rm -rf uploads/
	rm -rf temp/
	rm -f *.log

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

migrate:
	npm run prisma:migrate

seed:
	npm run seed

reset-db:
	npm run prisma:reset

parse-trial:
	npm run parse -- --config $(CONFIG) --all

sync-es:
	npm run parse sync-elasticsearch

search:
	npm run search query -f $(FILE)

search-batch:
	npm run search batch -d config/queries -o output

test-search:
	ts-node src/scripts/executeTestQueries.ts

search-examples:
	npm run search example -o config/queries