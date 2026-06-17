.PHONY: lint test docker-build docker-run

lint:
	npx --yes eslint@8 \
		--ignore-pattern "swa/vendor/**" \
		--ignore-pattern "browser/vendor/**" \
		"swa/**/*.js" "browser/**/*.js"

test:
	@FILES=$$(find swa browser -name "*.test.js" 2>/dev/null | tr '\n' ' '); \
	if [ -z "$$FILES" ]; then \
		echo "No test files — skipping."; \
	else \
		node --test $$FILES; \
	fi

docker-build:
	docker build -t lobstr:local .

docker-run: docker-build
	docker run -d --name lobstr-local -p 8080:80 lobstr:local
	@echo "Running at http://localhost:8080  |  stop: docker rm -f lobstr-local"
