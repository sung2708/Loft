import { test, expect } from "@playwright/test";

const viewports = [
  { name: "320x568 (iPhone SE)", width: 320, height: 568 },
  { name: "360x800 (Android Standard)", width: 360, height: 800 },
  { name: "390x844 (iPhone 12/13/14)", width: 390, height: 844 },
  { name: "412x915 (Pixel 7)", width: 412, height: 915 },
  { name: "768x1024 (iPad Portrait)", width: 768, height: 1024 },
  { name: "1024x768 (iPad Landscape)", width: 1024, height: 768 },
  { name: "1280x720 (720p HD)", width: 1280, height: 720 },
  { name: "1366x768 (Standard Laptop)", width: 1366, height: 768 },
  { name: "1440x900 (MacBook)", width: 1440, height: 900 },
  { name: "1920x1080 (Full HD)", width: 1920, height: 1080 },
];

test.describe("Responsive & Visual Boundaries", () => {
  for (const vp of viewports) {
    test(`Lobby should have no horizontal overflow and render cleanly on ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");

      // Wait for page hydration
      const heading = page.locator("h1");
      await expect(heading).toBeVisible();

      // Check horizontal overflow invariant
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasHorizontalOverflow).toBe(false);

      // Verify room input is visible and positioned within viewport bounds
      const roomInput = page.locator("#roomInput");
      await expect(roomInput).toBeVisible();
      const boundingBox = await roomInput.boundingBox();
      expect(boundingBox).not.toBeNull();
      if (boundingBox) {
        expect(boundingBox.x).toBeGreaterThanOrEqual(0);
        expect(boundingBox.x + boundingBox.width).toBeLessThanOrEqual(vp.width + 1); // 1px tolerance for subpixel
      }

      // Verify header exists and is visible
      const header = page.locator("header");
      await expect(header).toBeVisible();
    });
  }
});
