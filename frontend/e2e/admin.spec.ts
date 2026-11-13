import { expect, test } from "@playwright/test";

const ownerID = "11111111-1111-4111-8111-111111111111";
const user = {
  id: ownerID,
  aud: "authenticated",
  role: "authenticated",
  email: "admin@example.invalid",
  user_metadata: {},
};
const rooms = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    code: "123456",
    name: "Late Night Coding",
    owner_id: ownerID,
    owner_name: "Minh Nguyen",
    allow_guests: true,
    is_locked: false,
    password_required: false,
    ended: false,
    created_at: "2026-11-04T01:00:00Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    code: "654321",
    name: "Design Review",
    moderation: {
      actor_id: ownerID,
      reason: "policy",
      note: "Documented terms violation",
      created_at: "2026-11-04T01:00:00Z",
    },
    owner_id: ownerID,
    owner_name: "Minh Nguyen",
    allow_guests: false,
    is_locked: true,
    password_required: true,
    ended: true,
    created_at: "2026-11-03T01:00:00Z",
  },
];

test("admin signs out without reloading", async ({ page }) => {
  await page.route("**/auth/v1/logout?**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.goto("/admin");
  const logout = page.waitForResponse("**/auth/v1/logout?**");
  await page.getByRole("button", { name: "Sign out" }).click();
  expect(new URL((await logout).url()).searchParams.get("scope")).toBe("local");
  await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("admin reports when local sign-out could not revoke the session", async ({ page }) => {
  await page.route("**/auth/v1/logout?**", (route) =>
    route.fulfill({ status: 500, json: { message: "Unavailable" } }),
  );
  await page.goto("/admin");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  await expect(page.getByText("Signed out in this browser. The server could not confirm the session ended.")).toBeVisible();
});

test("admin links back to the current site on local and preview hosts", async ({ page }) => {
  await page.goto("/admin");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Back to Mingly" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(header.getByRole("link", { name: "Mingly", exact: true })).toHaveAttribute(
    "href",
    "/",
  );
});

test("admin subdomain renders a link to the configured public site", async ({ request }) => {
  const response = await request.get("/", { headers: { Host: "admin.mingly.site" } });
  expect(response.ok()).toBe(true);
  const html = await response.text();
  const brandHref = html.match(/<a aria-label="Mingly"[^>]* href="([^"]+)"/)?.[1];
  const backHref = html.match(/<a [^>]*aria-label="Về Mingly"[^>]* href="([^"]+)"/)?.[1];
  expect(brandHref).toMatch(/^https?:\/\//);
  expect(backHref).toBe(brandHref);
  if (process.env.CI) {
    expect(brandHref).toBe(process.env.NEXT_PUBLIC_SITE_URL);
  }
});

test.beforeEach(async ({ page }) => {
  const payload = Buffer.from(
    JSON.stringify({
      sub: ownerID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: "authenticated",
      role: "authenticated",
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`,
    refresh_token: "mock-refresh",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  };
  await page.addInitScript((session) => {
    localStorage.setItem("loft.locale", "en");
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      return /^sb-.*-auth-token$/.test(key)
        ? JSON.stringify(session)
        : original.call(this, key);
    };
  }, session);
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: { id: ownerID, type: "user", display_name: "Minh Nguyen" },
    }),
  );
  await page.route("**/api/v1/admin/overview", (route) =>
    route.fulfill({
      json: {
        users: 1284,
        rooms: 356,
        open_rooms: 24,
        ended_rooms: 332,
        new_users: 48,
        new_rooms: 19,
        open_reports: 3,
        suspended_users: 2,
        pending_deletions: 1,
        daily: Array.from({ length: 14 }, (_, i) => ({
          date: `2026-11-${String(i + 1).padStart(2, "0")}`,
          users: [3, 5, 4, 8, 6, 2, 1, 7, 9, 6, 4, 8, 11, 5][i],
          rooms: [1, 2, 1, 3, 2, 0, 1, 2, 4, 2, 1, 3, 5, 2][i],
        })),
      },
    }),
  );
  await page.route("**/api/v1/admin/rooms?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const items = rooms.filter(
      (r) =>
        (!params.get("status") ||
          (params.get("status") === "moderated"
            ? !!r.moderation
            : r.ended === (params.get("status") === "ended"))) &&
        (!params.get("owner") || r.owner_id === params.get("owner")) &&
        (!params.get("q") ||
          r.name.toLowerCase().includes(params.get("q")!.toLowerCase())),
    );
    return route.fulfill({
      json: { items, total: items.length, limit: 25, offset: 0 },
    });
  });
  await page.route("**/api/v1/admin/users?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ownerID,
            display_name: "Minh Nguyen",
            room_count: 2,
            created_at: "2026-09-01T01:00:00Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
    }),
  );
});

test.beforeEach(async ({ page }) => {
  await page.route(`**/api/v1/admin/users/${ownerID}`, (route) =>
    route.fulfill({
      json: {
        id: ownerID,
        display_name: "Minh Nguyen",
        room_count: 2,
        open_reports: 1,
        created_at: "2026-09-01T01:00:00Z",
        last_seen_at: "2026-11-12T08:00:00Z",
        member_rooms: 3,
        messages_sent: 41,
        total_reports: 1,
        reports_filed: 0,
        history: [],
        recent_reports: [],
      },
    }),
  );
  await page.route("**/api/v1/admin/reports?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 7,
            reporter_type: "guest",
            reporter_id: "44444444-4444-4444-8444-444444444444",
            reporter_name: "Lan",
            room_id: rooms[0].id,
            room_name: rooms[0].name,
            target_type: "user",
            target_id: ownerID,
            target_name: "Minh Nguyen",
            reason: "spam",
            details: "Posting links in chat",
            status: "open",
            created_at: "2026-11-12T09:00:00Z",
            target_reports: 2,
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
    }),
  );
});

test("admin hydrates with a saved English locale", async ({ page }) => {
  const hydrationErrors: string[] = [];
  const recordError = (message: string) => {
    if (/hydration|did not match/i.test(message)) hydrationErrors.push(message);
  };
  page.on("pageerror", (error) => recordError(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") recordError(message.text());
  });

  await page.goto("/admin");
  await expect(
    page.locator("header").getByText("Admin", { exact: true }),
  ).toBeAttached();
  expect(hydrationErrors).toEqual([]);
});

test("report queue opens a decision with a required note", async ({ page }) => {
  await page.goto("/admin?section=reports");
  await expect(page.getByRole("heading", { name: "Minh Nguyen" })).toBeVisible();
  await expect(page.getByText("Posting links in chat")).toBeVisible();
  await page.getByRole("button", { name: "Mark actioned", exact: true }).click();
  const save = page.getByRole("button", { name: "Save as actioned" });
  await expect(save).toBeDisabled();
  await page.getByRole("textbox", { name: /Moderation note/ }).fill("Warned the member about spam links");
  await expect(save).toBeEnabled();
  // The filter lives in the URL, so the view survives a reload.
  await page.getByRole("button", { name: "Dismissed", exact: true }).click();
  await expect(page).toHaveURL(/section=reports&status=dismissed/);
});

test("admin filters, owner drilldown, theme persistence and responsive layout", async ({
  page,
}, testInfo) => {
  await page.goto("/admin");
  await expect(page.getByRole("button", { name: /Total rooms/ })).toContainText(
    "356",
  );
  await page
    .getByRole("combobox", { name: "Theme", exact: true })
    .selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("overview-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page
    .getByRole("combobox", { name: "Theme", exact: true })
    .selectOption("light");
  await page.screenshot({
    path: testInfo.outputPath("overview-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: /Not ended.*24/ }).click();
  await expect(
    page.getByRole("button", { name: "Late Night Coding", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Design Review",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Room status" })
    .selectOption("moderated");
  await expect(
    page.getByRole("button", {
      name: "Design Review",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Design Review",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Moderation decision" }),
  ).toContainText("Documented terms violation");
  await expect(
    page.getByRole("button", { name: "End room", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Administration" })
    .getByRole("button", { name: "Users", exact: true })
    .click();
  await page.getByRole("button", { name: "Minh Nguyen", exact: true }).click();
  const ownerRequest = page.waitForRequest(
    (r) =>
      r.url().includes(`/admin/rooms?`) && r.url().includes(`owner=${ownerID}`),
  );
  await page.getByRole("button", { name: "View rooms", exact: true }).click();
  await ownerRequest;
  await expect(page.getByText("Owner: Minh Nguyen")).toBeVisible();
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("Late");
  await expect(
    page.getByRole("button", {
      name: "Design Review",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Search", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("rooms.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("ending requires confirmation, reports cleanup failure and supports retry", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/v1/admin/rooms/*/end", (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({
          status: 503,
          json: {
            error: {
              code: "ROOM_END_MEDIA_PENDING",
              message: "Room ended; call cleanup needs retrying",
            },
          },
        })
      : route.fulfill({ status: 204 });
  });
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Late Night Coding", exact: true })
    .click();
  await page.getByRole("button", { name: "End room", exact: true }).click();
  expect(calls).toBe(0);
  await expect(
    page.getByRole("button", { name: "End room", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Moderation reason" })
    .selectOption("policy");
  await page
    .getByRole("textbox", { name: "Moderation note" })
    .fill("Documented terms violation");
  await expect(page.getByText("End this room?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "End room", exact: true }).click();
  await expect(page.locator(".admin-shell [role=alert]")).toContainText(
    "Retry to disconnect",
  );
  await page.getByRole("button", { name: "End room", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Room ended");
  expect(calls).toBe(2);
});

test("forbidden data stays hidden and failed requests can be retried", async ({
  page,
}) => {
  await page.route("**/api/v1/admin/overview", (route) =>
    route.fulfill({ status: 403, json: { error: { code: "ADMIN_REQUIRED" } } }),
  );
  await page.goto("/admin");
  await expect(page.locator(".admin-shell [role=alert]")).toContainText(
    "does not have admin access",
  );
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.route("**/api/v1/admin/overview", (route) =>
    route.fulfill({ status: 500, json: {} }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await page.route("**/api/v1/admin/overview", (route) =>
    route.fulfill({
      json: {
        users: 1,
        rooms: 2,
        open_rooms: 1,
        ended_rooms: 1,
        new_users: 1,
        new_rooms: 2,
      },
    }),
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
});

test("owner-ended rooms can be moderated and deleted decisions remain readable", async ({
  page,
}) => {
  const ended = { ...rooms[0], ended: true };
  const deleted = {
    ...rooms[1],
    id: "44444444-4444-4444-8444-444444444444",
    name: "",
    code: "",
    owner_id: "",
    owner_name: "",
    deleted: true,
  };
  await page.route("**/api/v1/admin/rooms?**", (route) =>
    route.fulfill({
      json: { items: [ended, deleted], total: 2, limit: 25, offset: 0 },
    }),
  );
  let decision: unknown;
  await page.route("**/api/v1/admin/rooms/*/end", (route) => {
    decision = route.request().postDataJSON();
    return route.fulfill({ status: 204 });
  });
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Late Night Coding", exact: true })
    .click();
  await page.getByRole("button", { name: "End room", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Moderation reason" })
    .selectOption("policy");
  await page
    .getByRole("textbox", { name: "Moderation note" })
    .fill("Violation documented after owner closure");
  await page.getByRole("button", { name: "End room", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(decision).toEqual({
    reason: "policy",
    note: "Violation documented after owner closure",
  });
  await page.getByRole("button", { name: "Deleted room", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Moderation decision" }),
  ).toContainText("Documented terms violation");
  await expect(
    page.getByRole("button", { name: "Retry cleanup" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "End room", exact: true }),
  ).toHaveCount(0);
});

test("admin can replace an unfinished MFA enrollment after reload", async ({ page }) => {
  let unfinished: { id: string; friendly_name: string } | undefined;
  const removed: string[] = [];
  let enrollments = 0;
  await page.route("**/api/v1/admin/overview", (route) =>
    route.fulfill({ status: 403, json: { error: { code: "ADMIN_MFA_REQUIRED" } } }),
  );
  await page.route("**/auth/v1/user", (route) =>
    route.fulfill({ json: {
      ...user,
      factors: unfinished ? [{ ...unfinished, factor_type: "totp", status: "unverified" }] : [],
    } }),
  );
  await page.route("**/auth/v1/factors*", (route) => {
    if (unfinished) {
      return route.fulfill({ status: 422, json: { code: "mfa_factor_name_conflict" } });
    }
    unfinished = {
      id: `factor-${++enrollments}`,
      friendly_name: route.request().postDataJSON().friendly_name,
    };
    return route.fulfill({ json: {
      ...unfinished, type: "totp",
      totp: { qr_code: "<svg xmlns='http://www.w3.org/2000/svg'></svg>", secret: "TEST", uri: "otpauth://totp/test" },
    } });
  });
  await page.route("**/auth/v1/factors/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    if (route.request().method() !== "DELETE" || !unfinished || id !== unfinished.id) return route.abort();
    removed.push(unfinished.id);
    unfinished = undefined;
    return route.fulfill({ json: { id } });
  });

  await page.goto("/admin");
  const create = page.getByRole("button", { name: "Create QR code" });
  const qr = page.getByRole("img", { name: "QR code to add Mingly to your authenticator app" });
  await create.click();
  await expect(qr).toBeVisible();
  await page.reload();
  await create.click();
  await expect(qr).toBeVisible();
  expect(removed).toEqual(["factor-1"]);
  expect(enrollments).toBe(2);
});

test("admin navigation stays visible while scrolling", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("navigation", { name: "Administration" })).toBeVisible();
  await page.addStyleTag({ content: ".admin-layout { min-height: 250vh; }" });
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect.poll(async () =>
    Math.round((await page.locator(".admin-sidebar").boundingBox())?.y ?? -1),
  ).toBe(0);
});
