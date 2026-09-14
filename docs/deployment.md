# Deployment, Infrastructure & Packaging — Loft

## 1. Deployment Philosophy: Keep It Simple & Production-Grade

We avoid premature Kubernetes or service-mesh complexity. Loft is packaged for clean, reliable deployment across containerized environments (Fly.io, Render, Railway, AWS ECS, or simple Docker hosts).

```
   [User Browser]
         │
         ├── HTTPS ──► [Static Frontend CDN (Vercel / Cloudflare Pages)]
         │
         ├── WSS/HTTPS ──► [Reverse Proxy (Caddy / Cloudflare / Nginx)]
         │                        │
         │                        ▼
         │                 [Go Backend Monolith (Docker Container)]
         │                        │
         │                 +------+------+
         │                 │             │
         │                 ▼             ▼
         │           [PostgreSQL]     [Redis]
         │           (Supabase)       (Upstash/Managed)
         │
         └── WebRTC ──► [LiveKit Cloud / Self-Hosted SFU]
```

---

## 2. Environment Configuration Matrix

All configuration is parsed from environment variables at startup:

| Variable | Description | Required | Example |
| :--- | :--- | :---: | :--- |
| `ENV` | Execution environment (`development`, `staging`, `production`) | Yes | `production` |
| `PORT` | HTTP/WS bind port | Yes | `8080` |
| `DATABASE_URL` | PostgreSQL connection string | Yes | `postgres://postgres:pass@db.supabase.co:5432/postgres` |
| `REDIS_URL` | Redis connection URL (optional in single-node dev) | No | `redis://default:pass@redis.domain.com:6379` |
| `SUPABASE_URL` | Supabase project URL | Yes | `https://xyzproject.supabase.co` |
| `SUPABASE_JWT_SECRET` | Secret or public key used to verify Supabase JWTs | Yes | `super-secret-jwt-key` |
| `GUEST_HMAC_SECRET` | Secret key for signing room-scoped guest tokens | Yes | `32-byte-cryptographic-random-secret` |
| `LIVEKIT_URL` | LiveKit server WebRTC endpoint | Yes | `wss://loft.livekit.cloud` |
| `LIVEKIT_API_KEY` | LiveKit server API key | Yes | `APIKeyABC123` |
| `LIVEKIT_API_SECRET` | LiveKit server API secret (Never sent to client) | Yes | `SecretKeyXYZ789` |
| `ALLOWED_ORIGIN` | Strict CORS and CSWSH allowed frontend origin | Yes | `https://loft.app` |

---

## 3. Production Multi-Stage Dockerfile for Go

The backend compiles into a minimal, scratch/distroless container with non-root security permissions:

```dockerfile
# Build Stage
FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache ca-certificates git

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -o /app/bin/server ./cmd/server

# Final Stage (Minimal Security Profile)
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
COPY --from=builder /app/bin/server /server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/server"]
```

---

## 4. Local Development via Docker Compose

A developer can launch the complete local stack with a single command:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: loft-postgres
    environment:
      POSTGRES_USER: loft
      POSTGRES_PASSWORD: password
      POSTGRES_DB: loft
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: loft-redis
    ports:
      - "6379:6379"

  livekit:
    image: livekit/livekit-server:latest
    container_name: loft-livekit
    command: --dev
    ports:
      - "7880:7880"
      - "7881:7881"
      - "7882:7882/udp"

volumes:
  pgdata:
```
