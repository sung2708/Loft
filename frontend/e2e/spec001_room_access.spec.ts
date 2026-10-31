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

const testUser = { id: 'test-owner', aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', user_metadata: {} };
function testSession() {
  const payload = Buffer.from(JSON.stringify({sub:testUser.id, exp:Math.floor(Date.now()/1000)+3600, aud:'authenticated', role:'authenticated'})).toString('base64url');
  return {access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.test`,refresh_token:'mock-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:testUser};
}
async function admissionRoutes(page: import('@playwright/test').Page, room = publicRoom) {
  await page.route('**/api/v1/**', route => route.fulfill({status:404,contentType:'application/json',body:'{}'}));
  await page.route('**/api/v1/rooms/resolve?**', route => route.fulfill({contentType:'application/json',body:JSON.stringify({room})}));
  await page.route(`**/api/v1/rooms/${room.slug}`, route => route.fulfill({contentType:'application/json',body:JSON.stringify(room)}));
  await page.route('**/api/v1/users/me', route => route.fulfill({contentType:'application/json',body:JSON.stringify({id:testUser.id,type:'user',display_name:'Owner'})}));
}
async function signedIn(page: import('@playwright/test').Page) {
  await page.addInitScript(session => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      return /^sb-.*-auth-token$/.test(key) ? JSON.stringify(session) : original.call(this,key);
    };
  }, testSession());
}

test('Owner admission does not ask for a guest password', async ({page}) => {
  await signedIn(page);
  await admissionRoutes(page);
  await page.route('**/join-requests', route => route.fulfill({contentType:'application/json',body:'{"status":"not_required"}'}));
  await page.goto(`/join/${publicRoom.slug}`);
  await expect(page).toHaveURL(new RegExp(`/room/${publicRoom.slug}$`));
  await expect(page.locator('#room-password')).toHaveCount(0);
});

test('Pending automatic admission enters after approval without reload', async ({page}) => {
  await signedIn(page);
  await admissionRoutes(page, {...publicRoom,allow_guests:false,password_required:false});
  let approved = false;
  await page.route('**/join-requests', route => route.fulfill({contentType:'application/json',body:JSON.stringify({status:approved?'approved':'pending'})}));
  await page.goto(`/join/${publicRoom.slug}`);
  await expect(page.getByText(/your request was sent|yêu cầu đã được gửi/i)).toBeVisible();
  approved = true;
  await expect(page).toHaveURL(new RegExp(`/room/${publicRoom.slug}$`),{timeout:10000});
});

test('Google login returns through callback to the invited room instead of home', async ({page}) => {
  await admissionRoutes(page, {...publicRoom,allow_guests:false,password_required:false});
  await page.route('**/join-requests', route => route.fulfill({contentType:'application/json',body:'{"status":"approved"}'}));
  let redirectTo = '';
  await page.route('**/auth/v1/authorize?**', route => {
    redirectTo = new URL(route.request().url()).searchParams.get('redirect_to') || '';
    return route.fulfill({contentType:'text/html',body:'<p>Mock Google sign-in</p>'});
  });
  await page.route('**/auth/v1/token?**', route => route.fulfill({contentType:'application/json',body:JSON.stringify(testSession())}));
  await page.goto(`/join/${publicRoom.slug}`);
  await page.getByRole('button',{name:/sign in|đăng nhập/i}).last().click();
  await expect.poll(() => redirectTo).toContain('/auth/callback');
  expect(new URL(redirectTo).searchParams.get('next')).toBe(`/join/${publicRoom.slug}`);
  await page.goto(`/auth/callback?code=mock-one-time-code`);
  await expect(page).toHaveURL(new RegExp(`/room/${publicRoom.slug}$`),{timeout:15000});
});
