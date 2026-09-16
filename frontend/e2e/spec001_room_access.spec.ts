import { test, expect } from "@playwright/test";

const publicRoom = {
  id: "58bb9fe4-79bc-41c7-9d63-61c04815b668",
  slug: "000001",
  name: "Late Night Coding",
  allow_guests: true,
  max_participants: 12,
  is_locked: false,
  password_required: true,
};

async function mockResolvedRoom(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/rooms/resolve?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ room: publicRoom }),
    });
  });
}

test.describe("SPEC 001: Persistent Rooms & Room Access", () => {
  test("should show friendly room-not-found error on join page for non-existent room", async ({
    page,
  }) => {
    await page.route("**/api/v1/rooms/resolve?**", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "ROOM_NOT_FOUND", message: "Room not found" },
        }),
      });
    });
    await page.goto("/join/999999");

    await expect(page.getByRole("heading", { name: /phòng này không khả dụng|this room is unavailable/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /về trang chủ|back to home/i })).toBeVisible();
    await expect(page.getByText(/không tồn tại|does not exist|đã kết thúc|may have ended/i)).toBeVisible();
  });

  test("should prevent submission of single-character display name", async ({ page }) => {
    await mockResolvedRoom(page);
    let guestSessionRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/guest-session")) guestSessionRequests += 1;
    });
    await page.goto("/join/000001");

    const nameInput = page.locator('input[aria-label="Display name"], input[aria-label="Tên hiển thị"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill("A");
    const joinBtn = page.locator("#guest-join-btn");
    await expect(joinBtn).toBeVisible();
    await joinBtn.click();
    const alert = page.locator('[role="alert"]:not(#__next-route-announcer__)').first();
    await expect(alert).toContainText(/at least 2|ít nhất 2/i);
    expect(guestSessionRequests).toBe(0);
  });

  test("should never expose room password verifier or secrets in DOM or page source", async ({
    page,
  }) => {
    await mockResolvedRoom(page);
    await page.goto("/join/123456");

    await expect(page.getByText(publicRoom.name, { exact: true })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    const content = await page.content();
    expect(content).not.toContain("password_verifier");
    expect(content).not.toMatch(/argon2|bcrypt|pbkdf2|v1\$sha256\$/i);
  });
});
