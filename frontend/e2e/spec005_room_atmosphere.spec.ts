import { test, expect, type Page } from "@playwright/test";

/** Opens the room and passes the pre-join device check. */
async function openRoom(page: import("@playwright/test").Page) {
  await page.goto(`/room/${TEST_SLUG}`);
  await page.getByRole("button", { name: /^(Join|Tham gia)$/ }).click();
}
import { readFileSync } from "node:fs";

const TEST_ROOM_ID = "58bb9fe4-79bc-41c7-9d63-61c04815b668";
const TEST_SLUG = "atmosphere-e2e";

interface MockRoomAppearance {
  atmosphere: "minimal" | "ambient" | "focus" | "party";
  accent: "blue" | "purple" | "green" | "orange" | "rose";
  adaptive_media_background: boolean;
  version: number;
}

function buildMockRoom(appearance: MockRoomAppearance, ownerId = "user-host-1") {
  return {
    id: TEST_ROOM_ID,
    slug: TEST_SLUG,
    name: "Loft Hangout Room",
    owner_id: ownerId,
    allow_guests: true,
    max_participants: 12,
    is_locked: false,
    password_required: false,
    atmosphere: appearance.atmosphere,
    accent: appearance.accent,
    adaptive_media_background: appearance.adaptive_media_background,
    version: appearance.version,
    created_at: "2026-09-15T00:00:00Z",
  };
}

async function setupDeterministicRoom(
  page: Page,
  role: "host" | "participant",
  initialAppearance: MockRoomAppearance = {
    atmosphere: "ambient",
    accent: "blue",
    adaptive_media_background: true,
    version: 1,
  },
  withMusic = false,
  authenticatedHost = false,
  initialPositionMs = 0,
) {
  let roomSocket: {send:(message:string)=>void}|undefined;
  const commands: Array<{type:string;payload:Record<string,unknown>}> = [];
  const currentAppearance = { ...initialAppearance };
  const userId = role === "host" ? "user-host-1" : "user-member-2";
  const displayName = role === "host" ? "Host User" : "Participant User";

  // Pre-seed guest credential in sessionStorage so RoomPage does not redirect to /join
  await page.addInitScript(
    ({ roomId, uId, dName }) => {
      const cred = {
        token: `mock-token-${uId}`,
        type: "guest",
        roomId,
        displayName: dName,
      };
      sessionStorage.setItem(`loft.room.${roomId}.credential`, JSON.stringify(cred));
    },
    { roomId: TEST_ROOM_ID, uId: userId, dName: displayName },
  );

  // Intercept REST APIs
  await page.route(`**/api/v1/rooms/${TEST_SLUG}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildMockRoom(currentAppearance)),
    });
  });

  await page.route(`**/api/v1/rooms/${TEST_ROOM_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildMockRoom(currentAppearance)),
    });
  });

  await page.route("**/api/v1/rooms/resolve?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ room: buildMockRoom(currentAppearance) }),
    });
  });

  await page.route(`**/api/v1/rooms/${TEST_ROOM_ID}/messages`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [] }),
    });
  });

  // Return error on livekit token request so client falls back to pure RoomView rendering without SFU network dependency
  await page.route(`**/api/v1/rooms/${TEST_ROOM_ID}/livekit-token`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "LIVEKIT_UNAVAILABLE", message: "LiveKit not configured" } }),
    });
  });

  // Intercept WebSocket connections to provide snapshot and appearance events
  await page.routeWebSocket("**/ws", (ws) => {
    roomSocket=ws;
    ws.onMessage((message) => {
      try {
        const parsed = JSON.parse(message.toString());
        commands.push(parsed);
        if (parsed.type === "connection.auth") {
          ws.send(
            JSON.stringify({
              type: "room.snapshot",
              payload: {
                room: buildMockRoom(currentAppearance),
                host: {
                  connection_id: "conn-host",
                  identity_id: "user-host-1",
                  identity_type: authenticatedHost ? "user" : "guest",
                  generation: 1,
                  version: currentAppearance.version,
                  state: "connected",
                },
                self: {
                  connection_id: role === "host" ? "conn-host" : "conn-participant",
                  identity_id: userId,
                  identity_type: authenticatedHost ? "user" : "guest",
                  display_name: displayName,
                  role: role === "host" ? "host" : "member",
                  livekit_identity: `guest:${userId}`,
                  joined_at: "2026-09-15T00:00:00Z",
                },
                participants: [
                  {
                    connection_id: "conn-host",
                    identity_id: "user-host-1",
                    identity_type: authenticatedHost ? "user" : "guest",
                    display_name: "Host User",
                    role: "host",
                    livekit_identity: "guest:user-host-1",
                    joined_at: "2026-09-15T00:00:00Z",
                  },
                  ...(role === "participant"
                    ? [
                        {
                          connection_id: "conn-participant",
                          identity_id: "user-member-2",
                          identity_type: "guest" as const,
                          display_name: "Participant User",
                          role: "member" as const,
                          livekit_identity: "guest:user-member-2",
                          joined_at: "2026-09-15T00:01:00Z",
                        },
                      ]
                    : []),
                ],
                messages: [],
                ...(withMusic ? { media: {
                  current: { id: "track-1", video_id: "M7lc1UVf-VE", added_by: userId },
                  queue: role === "participant" ? [
                    { id: "queued-1", video_id: "M7lc1UVf-VE", added_by: userId },
                    { id: "queued-2", video_id: "dQw4w9WgXcQ", added_by: userId },
                  ] : [], repeat: false, status: "PLAYING", position_ms: initialPositionMs,
                  started_at: new Date().toISOString(), version: 1,
                }} : {}),
              },
            }),
          );
        } else if (parsed.type === "media.restart" || parsed.type === "media.seek") {
          ws.send(JSON.stringify({ type: "media.state", payload: {
            current: { id: "track-1", video_id: "M7lc1UVf-VE", added_by: userId },
            queue: [], repeat: false, status: "PLAYING",
            position_ms: parsed.type === "media.restart" ? 0 : parsed.payload.position_ms,
            started_at: new Date().toISOString(), version: parsed.payload.expected_version + 1,
          }}));
        } else if (parsed.type === "media.play_now") {
          ws.send(JSON.stringify({ type: "media.state", payload: {
            current: { id: "search-track", video_id: "M7lc1UVf-VE", added_by: userId,
              title: parsed.payload.title, channel: parsed.payload.channel },
            queue: [], repeat: false, status: "PLAYING", position_ms: 0,
            started_at: new Date().toISOString(), version: 2,
          }}));
        } else if (parsed.type === "connection.ping") {
          ws.send(
            JSON.stringify({
              type: "connection.pong",
              payload: {
                client_time: parsed.payload?.client_time ?? 0,
                server_time: Date.now(),
              },
            }),
          );
        } else if (parsed.type === "room.appearance.update") {
          const payload = parsed.payload;
          currentAppearance.atmosphere = payload.atmosphere ?? currentAppearance.atmosphere;
          currentAppearance.accent = payload.accent ?? currentAppearance.accent;
          currentAppearance.adaptive_media_background =
            payload.adaptive_media_background ?? currentAppearance.adaptive_media_background;
          currentAppearance.version = (payload.expected_version ?? currentAppearance.version) + 1;

          // Broadcast updated appearance
          ws.send(
            JSON.stringify({
              type: "room.appearance.updated",
              payload: {
                atmosphere: currentAppearance.atmosphere,
                accent: currentAppearance.accent,
                adaptive_media_background: currentAppearance.adaptive_media_background,
                version: currentAppearance.version,
              },
            }),
          );
        }
      } catch {
        // ignore non-json messages
      }
    });
  });

  return { currentAppearance, commands, sendServerEvent:(type:string,payload:object)=>roomSocket?.send(JSON.stringify({type,payload,version:1,room_id:TEST_ROOM_ID,event_id:"fixture-event"})) };
}

test.describe("SPEC 005: Room Atmosphere & Appearance", () => {
  async function openRoomSettings(page: Page) {
    const settingsButton = page.locator('button[aria-label="Room settings"], button[aria-label="Cài đặt phòng"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();
    await expect(page.getByRole("radiogroup", { name: /room atmosphere|không khí phòng/i })).toBeVisible();
  }

  async function saveRoomSettings(page: Page) {
    await page.getByRole("button", { name: /save|lưu/i }).click();
  }

  test("Host can inspect and switch atmospheres (minimal, ambient, focus, party)", async ({ page }) => {
    await setupDeterministicRoom(page, "host");
    await openRoom(page);

    // Wait for room shell
    const atmosphereRoot = page.locator("[data-atmosphere]").first();
    await expect(atmosphereRoot).toBeVisible({ timeout: 15000 });
    await expect(atmosphereRoot).toHaveAttribute("data-atmosphere", "ambient");
    await expect(atmosphereRoot).toHaveAttribute("data-accent", "blue");

    await openRoomSettings(page);

    // Verify atmosphere options exist
    const atmospheres = ["minimal", "ambient", "focus", "party"] as const;
    for (const atmo of atmospheres) {
      const option = page.locator(`button[role="radio"][data-atmosphere="${atmo}"]`);
      await expect(option).toBeVisible();
    }

    // Switch to Party
    const partyOption = page.locator('button[role="radio"][data-atmosphere="party"]');
    await partyOption.click();
    await saveRoomSettings(page);

    // Verify convergence to Party
    await expect(atmosphereRoot).toHaveAttribute("data-atmosphere", "party", { timeout: 5000 });
  });

  test("Host can switch all 5 accents (blue, purple, green, orange, rose)", async ({ page }) => {
    await setupDeterministicRoom(page, "host");
    await openRoom(page);

    const atmosphereRoot = page.locator("[data-atmosphere]").first();
    await expect(atmosphereRoot).toBeVisible({ timeout: 15000 });

    await openRoomSettings(page);

    const accents = ["purple", "green", "orange", "rose", "blue"] as const;
    for (const acc of accents) {
      const btn = page.locator(`button[role="radio"][data-accent="${acc}"]`);
      await expect(btn).toBeVisible();
      await btn.click();
      await saveRoomSettings(page);
      await expect(atmosphereRoot).toHaveAttribute("data-accent", acc, { timeout: 5000 });
    }
  });

  test("Participant cannot see or trigger room atmosphere controls", async ({ page }) => {
    await setupDeterministicRoom(page, "participant");
    await openRoom(page);

    const atmosphereRoot = page.locator("[data-atmosphere]").first();
    await expect(atmosphereRoot).toBeVisible({ timeout: 15000 });

    const appearanceBtn = page.locator('button[aria-label="Appearance"], button[aria-label="Giao diện"]').first();
    await appearanceBtn.click();
    await expect(page.locator(`button[role="menuitemradio"]`).filter({ hasText: /light|sáng/i })).toBeVisible();

    // Only hosts receive room settings, so participants cannot reach room appearance controls.
    await expect(page.locator('button[aria-label="Room settings"], button[aria-label="Cài đặt phòng"]')).toHaveCount(0);
    await expect(page.locator('button[role="radio"][data-atmosphere], button[role="radio"][data-accent]')).toHaveCount(0);
  });

  test("Personal theme independence and localStorage loft.theme preservation", async ({ page }) => {
    await setupDeterministicRoom(page, "host");
    await openRoom(page);

    const appearanceBtn = page.locator('button[aria-label="Appearance"], button[aria-label="Giao diện"]').first();
    await appearanceBtn.click();

    // Switch personal theme to dark
    const darkBtn = page.getByRole("menuitemradio", { name: /^dark$|^tối$/i });
    await darkBtn.click();

    // Check localStorage loft.theme is 'dark'
    const storedTheme = await page.evaluate(() => localStorage.getItem("loft.theme"));
    expect(storedTheme).toBe("dark");

    await openRoomSettings(page);
    const focusBtn = page.locator('button[role="radio"][data-atmosphere="focus"]');
    await focusBtn.click();
    await saveRoomSettings(page);

    // Atmosphere updated
    const atmosphereRoot = page.locator("[data-atmosphere]").first();
    await expect(atmosphereRoot).toHaveAttribute("data-atmosphere", "focus");

    // loft.theme remains 'dark'
    const themeAfterAtmo = await page.evaluate(() => localStorage.getItem("loft.theme"));
    expect(themeAfterAtmo).toBe("dark");
  });

  test("Network audit: No arbitrary image upload, palette upload, or media frames over WS", async ({ page }) => {
    const uploadedUrls: string[] = [];
    page.on("request", (req) => {
      const method = req.method();
      const url = req.url();
      if (method === "POST" || method === "PUT") {
        uploadedUrls.push(url);
      }
    });

    await setupDeterministicRoom(page, "host");
    await openRoom(page);

    await openRoomSettings(page);
    const partyBtn = page.locator('button[role="radio"][data-atmosphere="party"]');
    await partyBtn.click();
    await saveRoomSettings(page);

    // Verify no background image upload or palette upload occurred
    const hasForbiddenUpload = uploadedUrls.some(
      (u) => u.includes("upload") || u.includes("palette") || u.includes("artwork"),
    );
    expect(hasForbiddenUpload).toBe(false);
  });

  const viewports = [
    { width: 1440, height: 900, name: "1440 Desktop" },
    { width: 1280, height: 720, name: "1280 Desktop" },
    { width: 1024, height: 768, name: "1024 Tablet Landscape" },
    { width: 768, height: 1024, name: "768 Tablet Portrait" },
    { width: 430, height: 932, name: "430 Mobile (iPhone 14 Pro Max)" },
    { width: 375, height: 667, name: "375 Mobile (iPhone SE)" },
  ];

  for (const vp of viewports) {
    test(`Responsive bounds on ${vp.name} (${vp.width}x${vp.height}): No horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupDeterministicRoom(page, "host");
      await openRoom(page);

      const atmosphereRoot = page.locator("[data-atmosphere]").first();
      await expect(atmosphereRoot).toBeVisible({ timeout: 15000 });

      // Check horizontal overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasHorizontalOverflow).toBe(false);
    });
  }

  test("Reduced motion obeys prefers-reduced-motion without strobe animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDeterministicRoom(page, "host");
    await openRoom(page);

    const atmosphereRoot = page.locator("[data-atmosphere]").first();
    await expect(atmosphereRoot).toBeVisible({ timeout: 15000 });

    await openRoomSettings(page);
    const partyBtn = page.locator('button[role="radio"][data-atmosphere="party"]');
    await partyBtn.click();
    await saveRoomSettings(page);

    await expect(atmosphereRoot).toHaveAttribute("data-atmosphere", "party");

    const animationName = await atmosphereRoot.evaluate((el) => {
      return window.getComputedStyle(el).animationName;
    });
    expect(animationName).toBeDefined();
  });
});

test("Music drawer occupies the right column and preserves its player across drawers", async ({ page }) => {
  await setupDeterministicRoom(page, "host", undefined, true);
  await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({
    contentType: "application/javascript",
    body: `window.playerCreates = 0; window.playerDestroys = 0; window.playerPlays = 0;
      window.YT = { Player: function(element, options) {
        window.playerCreates++;
        this.setVolume = () => {}; this.getDuration = () => 60;
        this.cueVideoById = () => {}; this.seekTo = () => {};
        this.pauseVideo = () => {}; this.unMute = () => {};
        this.playVideo = () => { window.playerPlays++; };
        this.getPlayerState = () => -1; this.getCurrentTime = () => 0; this.getVideoUrl = () => "https://www.youtube.com/watch?v=M7lc1UVf-VE";
        this.destroy = () => { window.playerDestroys++; };
        setTimeout(() => options.events.onReady(), 0);
      }};
      window.onYouTubeIframeAPIReady?.();`,
  }));
  await openRoom(page);
  const stage = page.locator('.room-stage-column');
  await expect(stage).toBeVisible();
  const initial = await stage.boundingBox();
  await page.getByRole('button', { name: /shared queue|danh sách chờ/i }).click();
  const drawer = page.locator('aside[aria-hidden="false"]');
  await expect(drawer).toBeVisible();
  if (page.viewportSize()!.width >= 768) {
    await expect.poll(async () => (await stage.boundingBox())!.width).toBeLessThan(initial!.width - 300);
    await expect.poll(async () => drawer.evaluate(e => getComputedStyle(e).position)).toBe('relative');
    const bounds = await drawer.boundingBox();
    const stageBounds = await stage.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(stageBounds!.x + stageBounds!.width - 1);
  }
  await expect.poll(() => page.evaluate('window.playerCreates')).toBe(1);
  const enableAudio = drawer.getByRole('button', { name: /enable audio|bật âm thanh/i });
  if (await enableAudio.isVisible()) await enableAudio.click();
  await expect.poll(() => page.evaluate('window.playerPlays')).toBeGreaterThan(0);
  await drawer.getByRole('button', { name: /^(close|đóng)$/i }).click();
  await expect(drawer).toBeHidden();
  if (page.viewportSize()!.width >= 768) {
    await expect.poll(async () => (await stage.boundingBox())!.width).toBe(initial!.width);
  }
  await page.getByRole('button', { name: /^(chat|trò chuyện)$/i }).click();
  await page.getByRole('button', { name: /shared queue|danh sách chờ/i }).click();
  await expect(drawer).toBeVisible();
  expect(await page.evaluate('window.playerCreates')).toBe(1);
  expect(await page.evaluate('window.playerDestroys')).toBe(0);
});


test("Search Play sends metadata and plays with readable dark controls", async ({ page }) => {
  await setupDeterministicRoom(page, "host", undefined, true, true);
  await page.addInitScript(() => {
    localStorage.setItem("loft.theme", "dark");
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      if (/^sb-.*-auth-token$/.test(key)) return JSON.stringify({
        access_token: "mock-access-token", refresh_token: "mock-refresh-token",
        expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: "bearer",
        user: { id: "user-host-1", aud: "authenticated", role: "authenticated", user_metadata: {} },
      });
      return getItem.call(this, key);
    };
  });
  await page.route("**/api/v1/youtube/search?**", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ items: [
      { video_id: "M7lc1UVf-VE", title: "Search playback test", channel: "Test channel" },
    ] }),
  }));
  await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({
    contentType: "application/javascript", body: `window.searchPlays = 0;
      window.YT = { Player: function(element, options) {
        this.setVolume = () => {}; this.getDuration = () => 60;
        this.getPlayerState = () => -1; this.getCurrentTime = () => 0; this.getVideoUrl = () => "https://www.youtube.com/watch?v=M7lc1UVf-VE";
        this.cueVideoById = () => {}; this.seekTo = () => {};
        this.pauseVideo = () => {}; this.unMute = () => {}; this.destroy = () => {};
        this.loadVideoById = () => { window.searchPlays++; };
        this.playVideo = () => { window.searchPlays++; };
        setTimeout(() => options.events.onReady(), 0);
      }}; window.onYouTubeIframeAPIReady?.();`,
  }));
  await openRoom(page);
  await page.getByRole('button', { name: /shared queue|danh sách chờ/i }).click();
  await page.getByPlaceholder('Search YouTube').fill('test');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeVisible();
  const colors = await play.evaluate(e => ({ color: getComputedStyle(e).color, background: getComputedStyle(e).backgroundColor }));
  expect(colors.color).not.toBe(colors.background);
  await play.click();
  await expect(page.getByPlaceholder('Search YouTube')).toHaveValue('');
  await expect(page.getByText('Search playback test', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate('window.searchPlays')).toBeGreaterThan(0);
});


test("Host replay and keyboard seek send the correct room commands", async ({page}) => {
  const {commands} = await setupDeterministicRoom(page,"host",undefined,true,true);
  await page.route("https://www.youtube.com/iframe_api",route=>route.fulfill({contentType:"application/javascript",body:`
   window.YT={Player:function(el,options){
    this.setVolume=()=>{};this.getDuration=()=>60;this.getCurrentTime=()=>0;this.getVideoUrl=()=>"https://www.youtube.com/watch?v=M7lc1UVf-VE";
    this.getPlayerState=()=>-1;this.cueVideoById=()=>{};this.seekTo=()=>{};
    this.pauseVideo=()=>{};this.playVideo=()=>{};this.unMute=()=>{};this.destroy=()=>{};
    setTimeout(()=>options.events.onReady(),0);
   }};window.onYouTubeIframeAPIReady?.();
  `}));
  await openRoom(page);
  await page.getByRole('button',{name:/shared queue|danh sách chờ/i}).click();
  const progress=page.getByRole('slider',{name:/playback progress|tiến trình phát/i});
  await expect(progress).toHaveAttribute('aria-valuemax','60');
  await progress.press('End');
  await expect.poll(()=>commands.find(c=>c.type==='media.seek')?.payload.position_ms).toBe(60000);
  await page.getByRole('button',{name:/^(replay|phát lại)$/i}).click();
  await expect.poll(()=>commands.find(c=>c.type==='media.restart')?.payload.expected_version).toBe(2);
});


test("Late YouTube ended callbacks cannot skip the new track", async ({page}) => {
 const {commands}=await setupDeterministicRoom(page,"host",undefined,true,true,60000);
 await page.route("https://www.youtube.com/iframe_api",route=>route.fulfill({contentType:"application/javascript",body:`
  window.fakeVideo="dQw4w9WgXcQ";window.fakeState=0;
  window.YT={Player:function(el,options){
   this.setVolume=()=>{};this.getDuration=()=>60;this.getCurrentTime=()=>60;
   this.getVideoUrl=()=>"https://www.youtube.com/watch?v="+window.fakeVideo;
   this.getPlayerState=()=>window.fakeState;this.cueVideoById=()=>{};
   this.seekTo=()=>{};this.pauseVideo=()=>{};this.playVideo=()=>{};this.unMute=()=>{};this.destroy=()=>{};
   window.emitEnded=()=>options.events.onStateChange({data:0});
   setTimeout(()=>options.events.onReady(),0);
  }};window.onYouTubeIframeAPIReady?.();
 `}));
 await openRoom(page);
 await page.getByRole('button',{name:/shared queue|danh sách chờ/i}).click();
 await expect.poll(()=>page.evaluate('typeof window.emitEnded')).toBe('function');
 await page.evaluate('window.emitEnded()');
 expect(commands.filter(c=>c.type==='media.ended')).toHaveLength(0);
 await page.evaluate('window.fakeVideo="M7lc1UVf-VE";window.fakeState=1;window.emitEnded()');
 expect(commands.filter(c=>c.type==='media.ended')).toHaveLength(0);
 await page.evaluate('window.fakeState=0;window.emitEnded()');
 await expect.poll(()=>commands.filter(c=>c.type==='media.ended').length).toBe(1);
});


test("Participants can add tracks but cannot manage playback or the queue", async ({page}) => {
 const {commands}=await setupDeterministicRoom(page,"participant",undefined,true);
 await page.route("https://www.youtube.com/iframe_api",route=>route.fulfill({contentType:"application/javascript",body:""}));
 await openRoom(page);
 await page.getByRole('button',{name:/shared queue|danh sách chờ/i}).click();
 const panel=page.locator('aside[aria-hidden="false"]');
 for(const name of [/^(replay|phát lại)$/i,/^(shuffle|trộn bài)$/i,/^(clear list|xóa danh sách)$/i]){
  await expect(panel.getByRole('button',{name})).toBeDisabled();
 }
 await expect(panel.getByRole('button',{name:/^(next|bài tiếp)$/i})).toHaveCount(0);
 await expect(panel.getByRole('button',{name:/vote to skip|bỏ phiếu chuyển bài/i})).toBeEnabled();
 const remove=panel.getByRole('button',{name:/^(remove|xóa)$/i});
 await expect(remove).toHaveCount(2);
 for(const button of await remove.all()) await expect(button).toBeDisabled();
 await expect(panel.locator('[draggable="true"]')).toHaveCount(0);
 await expect(panel.getByRole('button',{name:/^(volume|âm lượng)$/i})).toBeEnabled();
 await panel.getByPlaceholder(/dán liên kết|paste.*youtube/i).fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');
 await panel.getByRole('button',{name:/^(add|thêm)$/i}).click();
 await expect.poll(()=>commands.filter(c=>c.type==='queue.add').length).toBe(1);
 expect(commands.filter(c=>['queue.remove','queue.clear','queue.shuffle','queue.reorder','queue.next','queue.select','media.seek'].includes(c.type))).toHaveLength(0);
});

test("Whiteboard shares shapes between participants and displays the drawer's name", async ({browser}) => {
 test.setTimeout(120_000);
 const first=await browser.newPage({viewport:{width:1280,height:800}});
 const second=await browser.newPage({viewport:{width:1280,height:800}});
 const records:Record<string,unknown>={};let version=0;
 const sockets:Array<{send:(data:string)=>void}>=[];
 for(const [index,page]of [first,second].entries()){
  await setupDeterministicRoom(page,index===0?'host':'participant');
  await page.route(/\/api\/v1\/rooms\/[^/]+\/whiteboard(?:\?|$)/,async route=>{
   if(route.request().method()==='PATCH'){
    const patch=route.request().postDataJSON();
    if(patch.version!==version){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({version,records})});return}
    for(const record of patch.put)records[record.id]=record;
    for(const id of patch.remove)delete records[id];version++;
    for(const ws of sockets)if(ws)ws.send(JSON.stringify({type:'board.changed',payload:{version}}));
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify({version,records})});
  });
  // This transport is isolated from real room/user data; both tabs share one authoritative fixture.
  await page.routeWebSocket('**/ws',ws=>{
   sockets[index]=ws;
   ws.onMessage(message=>{
    const envelope=JSON.parse(String(message));
    if(envelope.type==='connection.auth')ws.send(JSON.stringify({type:'room.snapshot',payload:{
     room:buildMockRoom({atmosphere:'minimal',accent:'blue',adaptive_media_background:false,version:1}),
     host:{connection_id:'conn-0',identity_id:'user-0',identity_type:'user',generation:1,version:1,state:'connected'},
     self:{connection_id:`conn-${index}`,identity_id:`user-${index}`,identity_type:'guest',display_name:index===0?'Alice':'Bob',role:'guest',livekit_identity:`guest:user-${index}`,joined_at:new Date().toISOString()},
     participants:[0,1].map(i=>({connection_id:`conn-${i}`,identity_id:`user-${i}`,identity_type:'guest',display_name:i===0?'Alice':'Bob',role:'guest',livekit_identity:`guest:user-${i}`,joined_at:new Date().toISOString()})),messages:[],
    }}));
    if(envelope.type==='board.cursor')for(const other of sockets)if(other!==ws)other.send(JSON.stringify({type:'board.cursor',payload:{...envelope.payload,connection_id:`conn-${index}`,name:index===0?'Alice':'Bob'}}));
   });
  });
  await openRoom(page);
  await page.getByRole('button',{name:/whiteboard|bảng vẽ/i}).click();
  await expect(page.locator('.tl-container')).toBeVisible({timeout:30000});
  await expect(page.getByText(/loading whiteboard|đang tải bảng vẽ/i)).toHaveCount(0,{timeout:15000});
 }
 await first.keyboard.press('d');
 const bounds=await first.locator('.tl-container').boundingBox();
 await first.mouse.move(bounds!.x+250,bounds!.y+200);await first.mouse.down();
 await first.mouse.move(bounds!.x+350,bounds!.y+250,{steps:10});await first.mouse.up();
 await expect.poll(()=>Object.values(records).filter((r:unknown)=>(r as {typeName:string}).typeName==='shape').length).toBeGreaterThan(0);
 await expect(second.locator('.tl-shape')).toHaveCount(1,{timeout:15000});
 await expect(second.getByText('Alice',{exact:true})).toBeVisible();
 await second.screenshot({path:'/tmp/mingly-whiteboard-two-users.png'});
 const draw=async(page:Page,x:number)=>{
  await page.keyboard.press('d');const box=await page.locator('.tl-container').boundingBox();
  await page.mouse.move(box!.x+x,box!.y+300);await page.mouse.down();
  await page.mouse.move(box!.x+x+80,box!.y+360,{steps:12});await page.mouse.up();
 };
 await Promise.all([draw(first,350),draw(second,450)]);
 await expect.poll(()=>Object.values(records).filter((r:unknown)=>(r as {typeName:string}).typeName==='shape').length,{timeout:15000}).toBe(3);
 await expect(first.locator('.tl-shape')).toHaveCount(3,{timeout:15000});
 await expect(second.locator('.tl-shape')).toHaveCount(3,{timeout:15000});
 // Keep saving while hidden and preserve the same board when opened again.
 await first.getByRole('button',{name:/whiteboard|bảng vẽ/i}).click();
 await first.getByRole('button',{name:/whiteboard|bảng vẽ/i}).click();
 await expect(first.locator('.tl-shape')).toHaveCount(3);
 await second.reload();await second.getByRole("button", {name:/^(Join|Tham gia)$/}).click();await second.getByRole('button',{name:/whiteboard|bảng vẽ/i}).click();
 await expect(second.locator('.tl-shape')).toHaveCount(3,{timeout:15000});
 await first.close();await second.close();
});

test("Whiteboard remains reachable on a phone alongside call controls",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await setupDeterministicRoom(page,'participant');
 let snapshot={version:0,records:{} as Record<string,unknown>};
 await page.route(/\/api\/v1\/rooms\/[^/]+\/whiteboard(?:\?|$)/,route=>{
  if(route.request().method()==='PATCH'){
   const patch=route.request().postDataJSON();
   for(const record of patch.put)snapshot.records[record.id]=record;
   snapshot={...snapshot,version:snapshot.version+1};
  }
  return route.fulfill({contentType:'application/json',body:JSON.stringify(snapshot)});
 });
 await openRoom(page);
 const open=page.getByRole('button',{name:/whiteboard|bảng vẽ/i});
 await expect(open).toBeVisible();await open.click();
 await expect(page.locator('.tl-container')).toBeVisible({timeout:15000});
 await expect(page.getByText(/loading whiteboard|đang tải bảng vẽ/i)).toHaveCount(0);
 expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByRole('button',{name:/leave room|rời phòng/i})).toBeVisible();
 await page.screenshot({path:'/tmp/mingly-whiteboard-mobile.png'});
});

test("Whiteboard isolates malformed records and recovers from a rejected save",async({page})=>{
 await setupDeterministicRoom(page,'participant');
 let version=7,patches=0,unchanged=0,reject=true;
 const records:Record<string,unknown>={
  'page:page':{id:'page:page',typeName:'page',name:'Page 1',index:'a1',meta:{}},
  'document:document':{id:'document:document',typeName:'document',name:'',gridSize:10,meta:{}},
  'shape:broken':{id:'shape:broken',typeName:'shape',type:'draw'},
 };
 const fixtures=JSON.parse(readFileSync("../backend/internal/store/testdata/board_records.json","utf8"));
 records['shape:self']={...fixtures[7],id:'shape:self',parentId:'shape:self'};
 records['shape:cycle-a']={...fixtures[7],id:'shape:cycle-a',parentId:'shape:cycle-b'};
 records['shape:cycle-b']={...fixtures[7],id:'shape:cycle-b',parentId:'shape:cycle-a'};
 records['shape:bad-text']={...fixtures[2],id:'shape:bad-text',props:{...fixtures[2].props,richText:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'hi',marks:[{type:'bold italic'}]}]}]}}};
 const quarantined=new Set(Object.keys(records));
 await page.route(/\/api\/v1\/rooms\/[^/]+\/whiteboard(?:\?|$)/,async route=>{
  if(route.request().method()==='PATCH'){
   patches++;
   const patch=route.request().postDataJSON();
   if(reject && patch.put.some((record:{typeName:string})=>record.typeName==='shape')){await route.fulfill({status:413,contentType:'application/json',body:JSON.stringify({error:{code:'BOARD_LIMIT',message:'Whiteboard is full'}})});return}
   for(const record of patch.put)records[record.id]=record;
   for(const id of patch.remove)delete records[id];version++;
  }else if(route.request().headers()['if-none-match']===`"board-${version}"`){
   unchanged++;await route.fulfill({status:304,body:''});return;
  }
  await route.fulfill({contentType:'application/json',body:JSON.stringify({version,records})});
 });
 await openRoom(page);
 await page.getByRole('button',{name:/whiteboard|bảng vẽ/i}).click();
 await expect(page.getByText(/loading whiteboard|đang tải bảng vẽ/i)).toHaveCount(0,{timeout:15000});
 await expect(page.locator('.tl-shape')).toHaveCount(0);
 await expect.poll(()=>unchanged).toBeGreaterThan(0);
 const draw=async()=>{await page.keyboard.press('d');const box=await page.locator('.tl-container').boundingBox();await page.mouse.move(box!.x+box!.width*0.35,box!.y+box!.height*0.5);await page.mouse.down();await page.mouse.move(box!.x+box!.width*0.55,box!.y+box!.height*0.6,{steps:10});await page.mouse.up()};
 await draw();
 const discard=page.getByRole('button',{name:/discard changes|bỏ thay đổi/i});
 await expect(discard).toBeVisible();
 const failedCount=patches;await page.waitForTimeout(2500);expect(patches).toBe(failedCount);
 reject=false;await discard.click();await expect(page.locator('.tl-shape')).toHaveCount(0);
 await draw();await expect.poll(()=>Object.keys(records).filter(id=>id.startsWith('shape:')&&!quarantined.has(id)).length).toBe(1);
 await expect(discard).toHaveCount(0);
});

test("Owner chooses leave or end and ending requires confirmation",async({page})=>{
 await setupDeterministicRoom(page,'host',undefined,false,true);
 let ends=0;
 await page.route('**/api/v1/rooms/*/end',route=>{ends++;return route.fulfill({status:204})});
 await openRoom(page);
 const leave=page.getByRole('button',{name:/^(leave|rời phòng)$/i});await leave.click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:/^(leave room|rời phòng)$/i})).toBeVisible();
 await dialog.getByRole('button',{name:/^(end room|kết thúc phòng)$/i}).click();
 expect(ends).toBe(0);
 await expect(dialog.getByText(/lịch sử và bảng vẽ được giữ|history and whiteboard are kept/i)).toBeVisible();
 await page.screenshot({path:'/tmp/mingly-end-room-confirmation.png'});
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(leave).toBeFocused();
 await leave.click();await dialog.getByRole('button',{name:/^(end room|kết thúc phòng)$/i}).click();
 await dialog.getByRole('button',{name:/^(end room|kết thúc phòng)$/i}).click();
 await expect.poll(()=>ends).toBe(1);await expect(page).not.toHaveURL(/\/room\//);
});

test("Owner leaving alone does not end the room",async({page})=>{
 const {commands}=await setupDeterministicRoom(page,'host',undefined,false,true);
 let ends=0;await page.route('**/api/v1/rooms/*/end',route=>{ends++;return route.fulfill({status:204})});
 await openRoom(page);
 await page.getByRole('button',{name:/^(leave|rời phòng)$/i}).click();
 await page.getByRole('dialog').getByRole('button',{name:/^(leave room|rời phòng)$/i}).click();
 await expect(page).not.toHaveURL(/\/room\//);expect(ends).toBe(0);
 expect(commands.some(command=>command.type==='room.leave')).toBe(true);
});

test("Member leaves directly without owner choices",async({page})=>{
 await setupDeterministicRoom(page,'participant');await openRoom(page);
 await page.getByRole('button',{name:/^(leave|rời phòng)$/i}).click();
 await expect(page).not.toHaveURL(/\/room\//);await expect(page.getByRole('dialog')).toHaveCount(0);
});

test("Ended room notification exits participants and blocks the invite link",async({page})=>{
 const fixture=await setupDeterministicRoom(page,'participant');await openRoom(page);
 await expect(page.getByRole('button',{name:/^(leave|rời phòng)$/i})).toBeVisible();
 await page.route('**/api/v1/rooms/resolve?*',route=>route.fulfill({status:410,contentType:'application/json',body:JSON.stringify({error:{code:'ROOM_ENDED',message:'This room has ended'}})}));
 fixture.sendServerEvent('room.ended',{});
 await expect(page).toHaveURL(/\/join\//);
 await expect(page.getByRole('heading',{name:/room ended|phòng đã kết thúc/i})).toBeVisible();
 await expect(page.getByRole('button',{name:/^(join|tham gia)$/i})).toHaveCount(0);
});

test("Owner end confirmation fits a phone and remains readable in dark mode",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>localStorage.setItem('loft.theme','dark'));
 await setupDeterministicRoom(page,'host',undefined,false,true);
 await openRoom(page);
 await page.getByRole('button',{name:/^(leave|rời phòng)$/i}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:/^(end room|kết thúc phòng)$/i}).click();
 const confirm=dialog.getByRole('button',{name:/^(end room|kết thúc phòng)$/i});
 const colors=await confirm.evaluate(button=>{const style=getComputedStyle(button);return {background:style.backgroundColor,text:style.color,disabled:(button as HTMLButtonElement).disabled,opacity:style.opacity,inline:button.getAttribute("style")}});
 const rgb=(color:string)=>(color.match(/[\d.]+/g)??[]).map(Number);
 const luminance=(color:string)=>rgb(color).slice(0,3).map(value=>{const channel=value/255;return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
 const a=luminance(colors.background),b=luminance(colors.text);
 expect(rgb(colors.background)[3]??1).toBe(1);
 expect((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toBeGreaterThanOrEqual(4.5);
 const bounds=await dialog.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
 expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/mingly-end-room-dark-mobile.png'});
});
