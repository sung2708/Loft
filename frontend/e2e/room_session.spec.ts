import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

/**
 * In-room flows against a mocked API and realtime socket, with Chromium's
 * fake camera/microphone (see playwright.config.ts launch args).
 */

const room = {
  id: "7a1d2c3e-0000-4000-8000-00000000e2e1",
  slug: "e2eroom1",
  name: "E2E Room",
  owner_id: "owner-1",
  allow_guests: true,
  max_participants: 10,
  is_locked: false,
  password_required: false,
  atmosphere: "minimal",
  accent: "neutral",
  adaptive_media_background: false,
  version: 1,
  created_at: "2026-01-01T00:00:00Z",
};

const self = {
  connection_id: "conn-self",
  identity_id: "guest-self",
  identity_type: "guest",
  display_name: "Tester",
  role: "participant",
  livekit_identity: "guest:guest-self",
  hand_raised: false,
};

type Socket = { route: WebSocketRoute | null };

function envelope(type: string, payload: unknown) {
  return JSON.stringify({ type, version: 1, event_id: crypto.randomUUID(), room_id: room.id, payload });
}

/** Seeds a guest credential, mocks the room API and answers the socket. */
async function enterRoomMocks(page: Page, options: { media?: { mic: boolean; camera: boolean } } = {}) {
  const socket: Socket = { route: null };
  const media = options.media ?? { mic: true, camera: true };
  await page.addInitScript(
    ({ roomId, media }) => {
      sessionStorage.setItem(
        `loft.room.${roomId}.credential`,
        JSON.stringify({ token: "guest-token", type: "guest", roomId, displayName: "Tester" }),
      );
      localStorage.setItem(
        "mingly.media.preferences",
        JSON.stringify({ version: 1, micOnJoin: media.mic, cameraOnJoin: media.camera }),
      );
      const calls: string[][] = [];
      (window as unknown as { __gumCalls: string[][] }).__gumCalls = calls;
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (constraints?: MediaStreamConstraints) => {
        calls.push(Object.entries(constraints ?? {}).filter(([, value]) => value).map(([key]) => key));
        return original(constraints);
      };
      // Lets a test put the tab "in the background".
      let hidden = false;
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
      (window as unknown as { __setHidden: (value: boolean) => void }).__setHidden = (value) => {
        hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      };
    },
    { roomId: room.id, media },
  );
  await page.route("**/api/v1/rooms/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/rooms/${room.slug}`) || path.endsWith(`/rooms/${room.id}`)) {
      return route.fulfill({ json: room });
    }
    return route.fallback();
  });
  await page.routeWebSocket(/\/ws$/, (ws) => {
    socket.route = ws;
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string };
      if (message.type === "connection.auth") {
        ws.send(
          envelope("room.snapshot", {
            room,
            host: { state: "connected", connection_id: "conn-host", identity_id: "owner-1", identity_type: "user", version: 1 },
            self,
            participants: [self],
            messages: [],
            picks: [],
          }),
        );
      } else if (message.type === "connection.ping") {
        ws.send(envelope("connection.pong", { server_time: Date.now() }));
      }
    });
  });
  return socket;
}

const joinButton = (page: Page) => page.getByRole("button", { name: /^(Join|Tham gia)$/ });

test.describe("Room session", () => {
  test("pre-join asks for camera and microphone together", async ({ page }) => {
    await enterRoomMocks(page);
    await page.goto(`/room/${room.slug}`);
    await expect(joinButton(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel(/Camera preview|Xem trước camera/)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __gumCalls: string[][] }).__gumCalls.length))
      .toBeGreaterThan(0);
    const calls = await page.evaluate(() => (window as unknown as { __gumCalls: string[][] }).__gumCalls);
    // One combined request (React dev mode may mount twice); never one prompt per device.
    for (const kinds of calls) expect(kinds.sort()).toEqual(["audio", "video"]);
    await expect(page.getByRole("button", { name: /Test sound|Phát thử/ })).toBeVisible();
  });

  test("shows unread chat in the tab title while the tab is hidden", async ({ page }) => {
    const socket = await enterRoomMocks(page, { media: { mic: false, camera: false } });
    await page.goto(`/room/${room.slug}`);
    await joinButton(page).click();
    await expect(page.getByRole("button", { name: /^(People|Thành viên)$/ })).toBeVisible({ timeout: 30_000 });
    const baseTitle = await page.title();

    await page.evaluate(() => (window as unknown as { __setHidden: (v: boolean) => void }).__setHidden(true));
    for (const id of ["m1", "m2"]) {
      socket.route?.send(
        envelope("chat.message", {
          id,
          room_id: room.id,
          sender_id: "guest-other",
          sender_type: "guest",
          sender_display_name: "Friend",
          content: `hello ${id}`,
          created_at: new Date().toISOString(),
        }),
      );
    }
    await expect(page).toHaveTitle(`(2) ${baseTitle}`);

    await page.evaluate(() => (window as unknown as { __setHidden: (v: boolean) => void }).__setHidden(false));
    await expect(page).toHaveTitle(baseTitle);
  });

  test("shows an offline notice immediately and clears it when back online", async ({ page, context }) => {
    await enterRoomMocks(page, { media: { mic: false, camera: false } });
    await page.goto(`/room/${room.slug}`);
    await joinButton(page).click();
    await expect(page.getByRole("button", { name: /^(People|Thành viên)$/ })).toBeVisible({ timeout: 30_000 });

    await context.setOffline(true);
    await expect(page.getByText(/You’re offline|Mất kết nối mạng/)).toBeVisible({ timeout: 3_000 });
    await context.setOffline(false);
    await expect(page.getByText(/You’re offline|Mất kết nối mạng/)).toBeHidden({ timeout: 10_000 });
  });
});
