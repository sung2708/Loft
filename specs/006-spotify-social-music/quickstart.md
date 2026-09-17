# Quickstart Validation: Spotify Social Music

This guide validates the experimental feature without making Spotify audio part of Mingly transport.

## Prerequisites

1. Use a current Spotify developer app configured with exact HTTPS redirect URIs (or the documented local-development exception).
2. Use an allowlisted Development Mode test account with the required Premium eligibility.
3. Configure test Mingly accounts, two rooms, and at least two browser tabs.
4. Start the existing Mingly backend, frontend, PostgreSQL, Redis, and LiveKit services using the repository’s normal development commands.

## Automated checks

```powershell
go test -race ./...
go vet ./...
go build ./...
cd frontend
node_modules\.bin\tsc --noEmit
node_modules\.bin\vitest run
node_modules\.bin\eslint .
```

Expected: existing Mingly checks pass; Spotify contract/privacy tests pass; no token or audio payload is present in room events or snapshots.

## Manual scenarios

1. Connect Spotify in Room A, leave, enter Room B, and confirm no OAuth prompt is caused solely by the room change.
2. Search a track, choose “Play for me”, and confirm only the initiating Spotify session changes; YouTube room media and LiveKit remain unchanged.
3. Add a Room Pick, view it from another participant, vote once, repeat the vote, and verify duplicate voting is rejected.
4. Enable “Share in this room” in Room A; verify safe activity appears in A and not in Room B. Leave A and verify the activity disappears.
5. Disconnect Spotify from account settings; verify Mingly login, room membership, chat, presence, camera, microphone, screen share, and YouTube remain usable.
6. Simulate provider 401/403/429/outage, unsupported browser, non-Premium account, and room reconnect. Verify graceful fallback and no credential leakage.
7. Inspect captured WebSocket, LiveKit metadata, Redis messages, room snapshots, and logs; Spotify tokens and audio must be absent.

See [data-model.md](./data-model.md) and [contracts/spotify-room-events.md](./contracts/spotify-room-events.md) for invariants.
