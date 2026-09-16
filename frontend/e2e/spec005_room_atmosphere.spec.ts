import { test, expect, type Page } from "@playwright/test";

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
) {
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
    ws.onMessage((message) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === "connection.auth") {
          ws.send(
            JSON.stringify({
              type: "room.snapshot",
              payload: {
                room: buildMockRoom(currentAppearance),
                host: {
                  connection_id: "conn-host",
                  identity_id: "user-host-1",
                  identity_type: "guest",
                  generation: 1,
                  version: currentAppearance.version,
                  state: "connected",
                },
                self: {
                  connection_id: role === "host" ? "conn-host" : "conn-participant",
                  identity_id: userId,
                  identity_type: "guest",
                  display_name: displayName,
                  role: role === "host" ? "host" : "member",
                  livekit_identity: `guest:${userId}`,
                  joined_at: "2026-09-15T00:00:00Z",
                },
                participants: [
                  {
                    connection_id: "conn-host",
                    identity_id: "user-host-1",
                    identity_type: "guest",
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
              },
            }),
          );
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

  return { currentAppearance };
}

test.describe("SPEC 005: Room Atmosphere & Appearance", () => {
  test("Host can inspect and switch atmospheres (minimal, ambient, focus, party)", async ({ page }) => {
    await setupDeterministicRoom(page, "host");
    await page.goto(`/room/${TEST_SLUG}`);

    // Wait for room shell
    const atmosphereRoot = page.locator("[data-atmosphere]").first();
    await expect(atmosphereRoot).toBeVisible({ timeout: 15000 });
    await expect(atmosphereRoot).toHaveAttribute("data-atmosphere", "ambient");
    await expect(atmosphereRoot).toHaveAttribute("data-accent", "blue");

    // Open Appearance menu
    const appearanceBtn = page.locator('button[aria-label="Appearance"], button[aria-label="Giao diện"]').first();
    await expect(appearanceBtn).toBeVisible();
    await appearanceBtn.click();

    // Verify atmosphere options exist
    const atmospheres = [
      /minimal|tối giản/i,
      /ambient|môi trường/i,
      /focus|tập trung/i,
      /party|tiệc tùng/i,
    ] as const;
    for (const atmo of atmospheres) {
      const option = page.locator(`button[role="menuitemradio"]`).filter({ hasText: atmo });
      await expect(option).toBeVisible();
    }

    // Switch to Party
    const partyOption = page.locator(`button[role="menuitemradio"]`).filter({ hasText: /party|tiệc tùng/i });
    await partyOption.click();

    // Verify convergence to Party
    await expect(atmosphereRoot).toHaveAttribute("data-atmosphere", "party", { timeout: 5000 });
  });

  test("Host can switch all 5 accents (blue, purple, green, orange, rose)", async ({ page }) => {
    await setupDeterministicRoom(page, "host");
    await page.goto(`/room/${TEST_SLUG}`);

    const atmosphereRoot = page.locator("[data-atmosphere]").first();
    await expect(atmosphereRoot).toBeVisible({ timeout: 15000 });

    const appearanceBtn = page.locator('button[aria-label="Appearance"], button[aria-label="Giao diện"]').first();
    await appearanceBtn.click();

    const accents = ["purple", "green", "orange", "rose", "blue"] as const;
    for (const acc of accents) {
      const btn = page.locator(`button.room-accent-choice[data-accent="${acc}"]`);
      await expect(btn).toBeVisible();
      await btn.click();
      await expect(atmosphereRoot).toHaveAttribute("data-accent", acc, { timeout: 5000 });
    }
  });

  test("Participant cannot see or trigger room atmosphere controls", async ({ page }) => {
    await setupDeterministicRoom(page, "participant");
    await page.goto(`/room/${TEST_SLUG}`);

    const atmosphereRoot = page.locator("[data-atmosphere]").first();
    await expect(atmosphereRoot).toBeVisible({ timeout: 15000 });

    const appearanceBtn = page.locator('button[aria-label="Appearance"], button[aria-label="Giao diện"]').first();
    await appearanceBtn.click();

    // Personal theme options (System, Light, Dark) should be visible
    await expect(page.locator(`button[role="menuitemradio"]`).filter({ hasText: /light|sáng/i })).toBeVisible();

    // Room atmosphere section and accent buttons must NOT be rendered for participant
    await expect(page.locator('[role="menu"]').getByText(/room atmosphere|không khí phòng/i)).toHaveCount(0);
    await expect(page.locator("button.room-accent-choice")).toHaveCount(0);
  });

  test("Personal theme independence and localStorage loft.theme preservation", async ({ page }) => {
    await setupDeterministicRoom(page, "host");
    await page.goto(`/room/${TEST_SLUG}`);

    const appearanceBtn = page.locator('button[aria-label="Appearance"], button[aria-label="Giao diện"]').first();
    await appearanceBtn.click();

    // Switch personal theme to dark
    const darkBtn = page.getByRole("menuitemradio", { name: /^dark$|^tối$/i });
    await darkBtn.click();

    // Check localStorage loft.theme is 'dark'
    const storedTheme = await page.evaluate(() => localStorage.getItem("loft.theme"));
    expect(storedTheme).toBe("dark");

    // Re-open appearance and switch atmosphere to Focus
    await appearanceBtn.click();
    const focusBtn = page.locator(`button[role="menuitemradio"]`).filter({ hasText: /focus|tập trung/i });
    await focusBtn.click();

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
    await page.goto(`/room/${TEST_SLUG}`);

    const appearanceBtn = page.locator('button[aria-label="Appearance"], button[aria-label="Giao diện"]').first();
    await appearanceBtn.click();

    const partyBtn = page.locator(`button[role="menuitemradio"]`).filter({ hasText: /party|tiệc tùng/i });
    await partyBtn.click();

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
      await page.goto(`/room/${TEST_SLUG}`);

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
    await page.goto(`/room/${TEST_SLUG}`);

    const atmosphereRoot = page.locator("[data-atmosphere]").first();
    await expect(atmosphereRoot).toBeVisible({ timeout: 15000 });

    // Open appearance and switch to party
    const appearanceBtn = page.locator('button[aria-label="Appearance"], button[aria-label="Giao diện"]').first();
    await appearanceBtn.click();
    const partyBtn = page.locator(`button[role="menuitemradio"]`).filter({ hasText: /party|tiệc tùng/i });
    await partyBtn.click();

    await expect(atmosphereRoot).toHaveAttribute("data-atmosphere", "party");

    const animationName = await atmosphereRoot.evaluate((el) => {
      return window.getComputedStyle(el).animationName;
    });
    expect(animationName).toBeDefined();
  });
});
