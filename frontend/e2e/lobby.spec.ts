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

  test("room input and brand stay visually stable on hover in both themes", async ({ page }) => {
    const roomInput = page.locator("#roomInput");
    const brand = page.getByRole("link", { name: "Mingly — Better when we’re together." });

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => {
        localStorage.setItem("loft.theme", value);
        document.documentElement.classList.toggle("dark", value === "dark");
      }, theme);

      const inputBefore = await roomInput.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      });
      const brandBefore = await brand.evaluate((element) => getComputedStyle(element).color);

      await roomInput.hover();
      await page.waitForTimeout(250);
      expect(await roomInput.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(inputBefore.background);
      expect(await roomInput.evaluate((element) => getComputedStyle(element).color)).toBe(inputBefore.color);

      await brand.hover();
      expect(await brand.evaluate((element) => getComputedStyle(element).color)).toBe(brandBefore);
    }
  });
});
