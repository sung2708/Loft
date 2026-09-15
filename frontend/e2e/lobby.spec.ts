import { test, expect } from "@playwright/test";

test.describe("Lobby & Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the lobby page with hero header and room input", async ({ page }) => {
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();

    // Branding is a release contract; an old Loft wordmark must not pass this test.
    await expect(page.getByText("Mingly", { exact: true }).first()).toBeVisible();
    await expect(page).toHaveTitle("Mingly — Better when we’re together.");

    const roomInput = page.locator("#roomInput");
    await expect(roomInput).toBeVisible();
    await expect(roomInput).toBeEditable();
  });

  test("should show validation alert when pressing enter with an empty room code", async ({ page }) => {
    const roomInput = page.locator("#roomInput");
    await roomInput.click();
    await roomInput.press("Enter");

    // Target the specific validation alert (excluding Next.js route announcer)
    const formAlert = page.locator('[role="alert"]:not(#__next-route-announcer__)');

    await expect(formAlert).toBeVisible();
  });

  test("should render header navigation elements", async ({ page }) => {
    // Header should contain branding or navigation anchors
    const header = page.locator("header");
    await expect(header).toBeVisible();

    // Verify theme toggle or language switcher exists in the header
    const buttons = header.locator("button");
    await expect(buttons.first()).toBeVisible();
  });
});
