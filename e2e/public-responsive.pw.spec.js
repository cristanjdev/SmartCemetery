// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * Mobile-responsiveness viewport tests for the PUBLIC pages.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5
 * Design: section 15 (Mobile responsiveness — public pages)
 *
 * The public search/kiosk pages fetch data at runtime. In environments where
 * the database is unreachable those fetches may fail, but the rendered layout
 * chrome (containers, navigation, search controls) is still present and its
 * responsive behaviour is what these tests assert. Navigation therefore waits
 * for `domcontentloaded` rather than full network idle.
 */

const PUBLIC_PAGES = [
  { name: "home", path: "/" },
  { name: "search", path: "/search" },
  { name: "map", path: "/map" },
];

// Minimum touch-target size in CSS pixels (Req 16.2). A 1px tolerance absorbs
// sub-pixel rounding in bounding-box measurements.
const MIN_TOUCH = 44;
const TOUCH_TOLERANCE = 1;

async function gotoPublic(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Give client components (search forms, nav) a brief moment to hydrate.
  await page.waitForTimeout(300);
}

/** Assert no horizontal overflow at the current viewport (Req 16.1). */
async function expectNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label}: horizontal overflow (scrollWidth ${overflow.scrollWidth} > innerWidth ${overflow.innerWidth})`
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

/**
 * Assert every visible interactive control meets the 44x44 touch target
 * minimum (Req 16.2). Hidden / zero-size elements are skipped.
 */
async function expectTouchTargets(page, label) {
  const selector = "button, a, input, select, textarea, [role=button]";
  const handles = await page.locator(selector).elementHandles();
  const undersized = [];

  for (const handle of handles) {
    const visible = await handle.isVisible().catch(() => false);
    if (!visible) continue;

    // Skip Next.js dev-mode injected controls (dev indicator / overlay).
    // These only exist under `next dev` and are not part of the app UI.
    const isDevTooling = await handle.evaluate((el) => {
      if (el.closest && el.closest("nextjs-portal")) return true;
      const id = el.id || "";
      return id.startsWith("next-") || id.startsWith("__next");
    });
    if (isDevTooling) continue;

    const box = await handle.boundingBox();
    if (!box || box.width === 0 || box.height === 0) continue;

    if (
      box.width < MIN_TOUCH - TOUCH_TOLERANCE ||
      box.height < MIN_TOUCH - TOUCH_TOLERANCE
    ) {
      const desc = await handle.evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const cls = el.className && typeof el.className === "string"
          ? `.${el.className.trim().split(/\s+/).join(".")}`
          : "";
        return `${tag}${id}${cls}`;
      });
      undersized.push(
        `${desc} (${Math.round(box.width)}x${Math.round(box.height)})`
      );
    }
  }

  expect(
    undersized,
    `${label}: interactive controls below ${MIN_TOUCH}x${MIN_TOUCH}px: ${undersized.join(", ")}`
  ).toEqual([]);
}

/**
 * Assert a primary navigation / entry control is reachable within the viewport
 * without scrolling (Req 16.3): a nav element, a header link, or the page's
 * primary search input must be visible with its top edge inside the viewport.
 */
async function expectNavReachable(page, label) {
  const candidates = page.locator(
    "nav a, nav button, header a, a[href='/'], a[href='/login'], a[href='/search'], input[type=text]"
  );
  const count = await candidates.count();
  const innerHeight = await page.evaluate(() => window.innerHeight);

  let reachable = false;
  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const box = await el.boundingBox();
    if (!box) continue;
    // Visible and its top edge is within the initial viewport (no scroll).
    if (box.y >= 0 && box.y < innerHeight) {
      reachable = true;
      break;
    }
  }

  expect(
    reachable,
    `${label}: no primary navigation/search control reachable within the viewport`
  ).toBe(true);
}

// --- Per-viewport suite (Req 16.1, 16.2, 16.3, and 16.5 for the sub-320 project)
for (const { name, path } of PUBLIC_PAGES) {
  test.describe(`public ${name} (${path})`, () => {
    test(`no horizontal overflow`, async ({ page }) => {
      await gotoPublic(page, path);
      await expectNoHorizontalOverflow(page, `${name}`);
    });

    test(`touch targets >= ${MIN_TOUCH}x${MIN_TOUCH}`, async ({ page }) => {
      await gotoPublic(page, path);
      await expectTouchTargets(page, `${name}`);
    });

    test(`primary navigation reachable`, async ({ page }, testInfo) => {
      await gotoPublic(page, path);
      await expectNavReachable(page, `${name}`);

      // Req 16.5: below 320px, content must remain reachable via vertical
      // scrolling with navigation still present.
      const width = testInfo.project.use.viewport?.width ?? 0;
      if (width < 320) {
        // Scroll to the bottom to prove every part of the page is reachable
        // via vertical scrolling. Disable smooth scrolling first so the scroll
        // is instant and `scrollY` reflects the final position immediately.
        await page.evaluate(() => {
          document.documentElement.style.scrollBehavior = "auto";
          window.scrollTo(0, document.documentElement.scrollHeight);
        });
        await page.waitForTimeout(150);
        // Lazy/hydrated content can increase the document height after the
        // first scroll. Scroll once more to assert the final settled layout.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(100);
        const after = await page.evaluate(() => ({
          scrollY: window.scrollY,
          innerHeight: window.innerHeight,
          scrollHeight: document.documentElement.scrollHeight,
        }));
        // All content is reachable when either it already fits, or we managed
        // to scroll such that the bottom of the document is now in view.
        const reachedBottom =
          after.scrollY + after.innerHeight >= after.scrollHeight - 2;
        expect(
          reachedBottom,
          `${name} sub-320: bottom of content not reachable via vertical scroll (scrollY ${after.scrollY} + innerHeight ${after.innerHeight} < scrollHeight ${after.scrollHeight})`
        ).toBe(true);

        // Navigation must still be present/reachable after scrolling.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(100);
        await expectNavReachable(page, `${name} sub-320 after scroll`);
      }
    });
  });
}

// --- Orientation re-flow (Req 16.4): portrait -> landscape on the same page.
// Runs once (guarded to a single project to avoid redundant matrix expansion).
test.describe("orientation re-flow", () => {
  for (const { name, path } of PUBLIC_PAGES) {
    test(`${name} re-flows portrait <-> landscape without overflow`, async ({ page }, testInfo) => {
      test.skip(
        testInfo.project.name !== "portrait-375",
        "Orientation re-flow is exercised once from the portrait-375 project."
      );

      // Portrait
      await page.setViewportSize({ width: 375, height: 667 });
      await gotoPublic(page, path);
      await expectNoHorizontalOverflow(page, `${name} portrait`);
      await expectNavReachable(page, `${name} portrait`);

      // Rotate to landscape and re-assert criteria 1–3 (Req 16.4).
      await page.setViewportSize({ width: 667, height: 375 });
      await page.waitForTimeout(300);
      await expectNoHorizontalOverflow(page, `${name} landscape`);
      await expectNavReachable(page, `${name} landscape`);
    });
  }
});
