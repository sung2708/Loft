SHELL := pwsh.exe
.SHELLFLAGS := -NoProfile -ExecutionPolicy Bypass -Command

BACKEND_DIR := backend
FRONTEND_DIR := frontend
AIR := $(USERPROFILE)/go/bin/air.exe

.PHONY: help air install-air dev run stop backend frontend build test test-backend test-frontend fmt vet clean

help:
	@Write-Output "make air          - run Go backend with Air hot reload"
	@Write-Output "make install-air  - install Air to GOPATH/bin"
	@Write-Output "make dev          - start backend hot reload"
	@Write-Output "make run          - start backend (Air) and frontend together"
	@Write-Output "make stop         - stop dev processes started by make run"
	@Write-Output "make build        - build backend and frontend"
	@Write-Output "make test         - run backend and frontend tests"
	@Write-Output "make fmt          - format Go sources"
	@Write-Output "make vet          - run go vet"

install-air:
	go install github.com/air-verse/air@latest

air:
	if (-not (Get-Command $(AIR) -ErrorAction SilentlyContinue)) { Write-Error "Air is not installed. Run: make install-air"; exit 1 }; Set-Location $(BACKEND_DIR); $(AIR) -c ../.air.toml

dev: air

run:
	if (-not (Test-Path "$(BACKEND_DIR)/tmp")) { New-Item -ItemType Directory -Force "$(BACKEND_DIR)/tmp" | Out-Null }; & "$(FRONTEND_DIR)/node_modules/.bin/concurrently.cmd" -k -n backend,frontend -c cyan,green "make air" "pnpm --dir $(FRONTEND_DIR) dev --hostname 0.0.0.0"

stop:
	Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'make (air|frontend)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

backend:
	Set-Location $(BACKEND_DIR); go run ./cmd/server

frontend:
	Set-Location $(FRONTEND_DIR); pnpm dev --hostname 0.0.0.0

build:
	Set-Location $(BACKEND_DIR); go build ./...
	Set-Location $(FRONTEND_DIR); npm run build

test-backend:
	Set-Location $(BACKEND_DIR); go test ./...

test-frontend:
	Set-Location $(FRONTEND_DIR); npm test -- --run

test: test-backend test-frontend

fmt:
	Set-Location $(BACKEND_DIR); gofmt -w (Get-ChildItem -Recurse -Filter *.go | ForEach-Object FullName)

vet:
	Set-Location $(BACKEND_DIR); go vet ./...

clean:
	if (Test-Path "$(BACKEND_DIR)/tmp") { Remove-Item -Recurse -Force "$(BACKEND_DIR)/tmp" }
