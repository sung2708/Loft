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
