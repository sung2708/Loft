# MVP 2 WebSocket load profiles

`k6_room_burst.js` opens one authenticated WebSocket per VU, measures the
upgrade-to-snapshot time, keeps each session active with heartbeats, and fails
the run on admission errors. The fixture must contain **unique credentials**
within each room. Generate guest sessions using the normal API or use test
users; save the JSON fixture outside Git and never share it in logs.

Example fixture:

```json
[
  { "room_id": "<room-uuid>", "token": "<unique-bearer-token>" }
]
```

From `backend/`, set `LOFT_USERS_FILE` to the fixture and run each profile:

```powershell
k6 run -e LOFT_VUS=10  -e LOFT_SESSION_MS=15000 loadtest/k6_room_burst.js
k6 run -e LOFT_VUS=25  -e LOFT_SESSION_MS=15000 loadtest/k6_room_burst.js
k6 run -e LOFT_VUS=50  -e LOFT_SESSION_MS=15000 loadtest/k6_room_burst.js
k6 run -e LOFT_VUS=100 -e LOFT_SESSION_MS=15000 loadtest/k6_room_burst.js
```

Set `LOFT_WS_URL` and `LOFT_ORIGIN` for the target deployment. Distribute users
over enough rooms to satisfy each room's configured `max_participants`; the
default room capacity is 12. Observe `/metrics`, process RSS, and goroutine
count during each run. A passing k6 run proves admission and snapshot delivery
only; chat fan-out, slow consumers, cross-instance coordination, and hardware
failures need separate runs.
