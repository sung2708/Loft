// Run with a JSON credential fixture outside the repository:
// k6 run -e LOFT_WS_URL=ws://localhost:8080/ws -e LOFT_USERS_FILE=./users.json \
//   -e LOFT_VUS=10 -e LOFT_DURATION=30s loadtest/k6_room_burst.js
// Fixture: [{"room_id":"<uuid>","token":"<unique guest or user token>"}, ...]
// Never commit the fixture: it contains bearer credentials.
import ws from 'k6/ws';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const users = new SharedArray('room users', () =>
  JSON.parse(open(__ENV.LOFT_USERS_FILE || './users.json')),
);
const vus = Number(__ENV.LOFT_VUS || '10');
const sessionMs = Number(__ENV.LOFT_SESSION_MS || '15000');
const pingMs = Number(__ENV.LOFT_PING_MS || '5000');
const wsURL = __ENV.LOFT_WS_URL || 'ws://localhost:8080/ws';
const eventID = () => `${Date.now()}-${exec.vu.idInTest}-${Math.random()}`;
if (!Number.isInteger(vus) || vus < 1 || users.length < vus) {
  throw new Error('LOFT_VUS must be positive and users.json must contain at least that many unique credentials');
}
if (new Set(users.slice(0, vus).map((u) => `${u.room_id}:${u.token}`)).size !== vus) {
  throw new Error('Each VU needs a unique credential in its room');
}

export const options = {
  scenarios: {
    room_burst: {
      executor: 'per-vu-iterations',
      vus,
      iterations: 1,
      maxDuration: __ENV.LOFT_DURATION || '45s',
    },
  },
  thresholds: {
    loft_snapshot_ms: ['p(95)<200'],
    loft_snapshot_ok: [`count>=${vus}`],
    loft_auth_failed: ['count==0'],
  },
};

const snapshotMs = new Trend('loft_snapshot_ms', true);
const snapshotOK = new Counter('loft_snapshot_ok');
const authFailed = new Counter('loft_auth_failed');
const pongs = new Counter('loft_pongs');

export default function () {
  const user = users[exec.vu.idInTest - 1];
  let connectedAt = 0;
  let admitted = false;
  const res = ws.connect(wsURL, { headers: { Origin: __ENV.LOFT_ORIGIN || 'http://localhost:3000' } }, (socket) => {
    socket.on('open', () => {
      connectedAt = Date.now();
      socket.send(JSON.stringify({
        type: 'connection.auth', version: 1, event_id: eventID(),
        room_id: user.room_id,
        payload: { token: user.token, room_id: user.room_id, tab_session_id: eventID() },
      }));
    });
    socket.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw); } catch { authFailed.add(1); socket.close(); return; }
      if (event.type === 'room.snapshot' && !admitted) {
        admitted = true;
        snapshotOK.add(1);
        snapshotMs.add(Date.now() - connectedAt);
        socket.setInterval(() => socket.send(JSON.stringify({
          type: 'connection.ping', version: 1, event_id: eventID(),
          room_id: user.room_id, payload: { client_time: Date.now() },
        })), pingMs);
        socket.setTimeout(() => socket.close(), sessionMs);
      } else if (event.type === 'connection.pong') {
        pongs.add(1);
      } else if (event.type === 'error') {
        authFailed.add(1);
        socket.close();
      }
    });
    socket.setTimeout(() => { if (!admitted) { authFailed.add(1); socket.close(); } }, 10000);
  });
  check(res, { 'websocket upgraded': (r) => r && r.status === 101 });
}
