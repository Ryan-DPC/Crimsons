APP=crimsons-server
MODULE=github.com/Ryan-DPC/Crimsons/server-go
BIN_DIR=bin
VERSION?=3.1.6

.PHONY: build build-release test run tidy

build:
	mkdir -p $(BIN_DIR)
	go build -o $(BIN_DIR)/$(APP) ./cmd/crimsons-server

# Release embed: read crimson/.env like Rust build.rs, bake URL/key into the binary.
build-release:
	mkdir -p $(BIN_DIR)
	@URL=$$(grep -E '^VITE_SUPABASE_URL=' ../crimson/.env 2>/dev/null | head -1 | cut -d= -f2-); \
	KEY=$$(grep -E '^VITE_SUPABASE_ANON_KEY=' ../crimson/.env 2>/dev/null | head -1 | cut -d= -f2-); \
	if [ -z "$$URL" ] || [ -z "$$KEY" ]; then echo "crimson/.env missing VITE_SUPABASE_* — refusing release build"; exit 1; fi; \
	CGO_ENABLED=0 go build -ldflags "-s -w \
		-X main.embeddedSupabaseURL=$$URL \
		-X main.embeddedSupabaseAnonKey=$$KEY" \
		-o $(BIN_DIR)/$(APP) ./cmd/crimsons-server

test:
	go test ./...

run: build
	CRIMSON_DEV=1 ./$(BIN_DIR)/$(APP)

tidy:
	go mod tidy
