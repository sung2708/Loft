# Database Architecture & Persistence Design — Loft

## 1. Relational Database Principles

Loft utilizes **PostgreSQL** (hosted via Supabase) as its sole source of durable truth.
1. **Direct Connection Pool:** The Go backend connects directly using `pgxpool` (`jackc/pgx/v5`). It does **not** make unnecessary REST requests through PostgREST for backend workflows.
2. **Parameterized SQL Queries:** No dynamic SQL string concatenation. All queries use parameterized placeholders (`$1, $2`) to completely eliminate SQL injection.
3. **Sequential Migrations:** Schema changes are tracked as forward-only SQL migration files in `backend/migrations/` (e.g., `000001_init.up.sql`).
4. **Zero Ephemeral Pollution:** Presence heartbeats, LiveKit track states, typing indicators, and playback position ticks are **never** persisted to PostgreSQL.

---

## 2. Core Relational Schema

```sql
-- 1. Profiles (Linked to Supabase auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY,
    username VARCHAR(32) UNIQUE NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Rooms
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(48) UNIQUE NOT NULL,
    name VARCHAR(80) NOT NULL,
    host_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    passcode_hash TEXT,
    max_participants INT NOT NULL DEFAULT 25,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Room Memberships
CREATE TYPE room_role AS ENUM ('host', 'moderator', 'member', 'guest');

CREATE TABLE room_memberships (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role room_role NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);

-- 4. Chat Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content VARCHAR(2000) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Invites
CREATE TABLE invites (
    code VARCHAR(16) PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES profiles(id),
    max_uses INT,
    uses_count INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Room Bans
CREATE TABLE room_bans (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    banned_by UUID NOT NULL REFERENCES profiles(id),
    reason TEXT,
    banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);
```

---

## 3. Justified Indexes & Access Patterns

Indexes are added strictly to satisfy concrete query patterns:

| Index | Target Query Pattern | Rationale |
| :--- | :--- | :--- |
| `CREATE INDEX idx_messages_room_time ON messages (room_id, created_at DESC);` | Paginated chat history: `SELECT * FROM messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 50` | Prevents full table scan on millions of archived room messages. |
| `CREATE INDEX idx_memberships_user ON room_memberships (user_id);` | Fetching a user's joined rooms on dashboard: `SELECT * FROM room_memberships WHERE user_id = $1` | Enables fast reverse lookup from user to their rooms. |
| `CREATE INDEX idx_invites_lookup ON invites (code) WHERE expires_at > NOW();` | Resolving active invite links during joining flow | Partial index ensures instant invite verification with minimal B-tree footprint. |

---

## 4. Transaction Boundaries & External I/O Prohibition

### Atomic Workflows
Transactions are utilized when multiple durable state changes must succeed or fail together:
1. **Host Transfer:**
   ```sql
   BEGIN;
   UPDATE rooms SET host_id = $new_host_id WHERE id = $room_id;
   UPDATE room_memberships SET role = 'host' WHERE room_id = $room_id AND user_id = $new_host_id;
   UPDATE room_memberships SET role = 'moderator' WHERE room_id = $room_id AND user_id = $old_host_id;
   COMMIT;
   ```
2. **Moderator Ban:**
   ```sql
   BEGIN;
   INSERT INTO room_bans (room_id, user_id, banned_by, reason) VALUES ($1, $2, $3, $4);
   DELETE FROM room_memberships WHERE room_id = $1 AND user_id = $2;
   COMMIT;
   ```

### The Zero External I/O Invariant
> **CRITICAL RULE:** Never execute network I/O (e.g. calling LiveKit APIs, publishing to Redis Pub/Sub, or writing to WebSocket channels) while inside an open PostgreSQL transaction. Doing so holds database locks open across unpredictable network latencies, risking connection pool starvation.
