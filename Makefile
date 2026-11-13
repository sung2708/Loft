SHELL := pwsh.exe
.SHELLFLAGS := -NoProfile -ExecutionPolicy Bypass -Command

BACKEND_DIR := backend
FRONTEND_DIR := frontend
AIR := $(USERPROFILE)/go/bin/air.exe

.PHONY: help air install-air dev backend frontend build test test-backend test-frontend fmt vet clean

help:
	@Write-Output "make air          - run Go backend with Air hot reload"
	@Write-Output "make install-air  - install Air to GOPATH/bin"
	@Write-Output "make dev          - start backend hot reload"
	@Write-Output "make build        - build backend and frontend"
	@Write-Output "make test         - run backend and frontend tests"
	@Write-Output "make fmt          - format Go sources"
	@Write-Output "make vet          - run go vet"

install-air:
	go install github.com/air-verse/air@latest

air:
	if (-not (Get-Command $(AIR) -ErrorAction SilentlyContinue)) { Write-Error "Air is not installed. Run: make install-air"; exit 1 }; Set-Location $(BACKEND_DIR); $(AIR) -c ../.air.toml

dev: air

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
