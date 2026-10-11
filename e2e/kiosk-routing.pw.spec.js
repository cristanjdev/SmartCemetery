// @ts-check
const { test, expect } = require("@playwright/test");

const grave = {
  id: 42,
  deceasedName: "Maria Santos",
  status: "active",
  burialDate: "2020-05-04T00:00:00.000Z",
  plot: {
    id: 12,
    plotNumber: "A-012",
    status: "occupied",
    gpsLat: 8.4648,
    gpsLng: 124.6579,
    locationDetail: {
      id: 3,
      subsection: "A",
      sortOrder: 1,
      location: { id: 1, name: "Main Field" },
    },
  },
};

const routeResponse = {
  code: "Ok",
  routes: [{
    geometry: { type: "LineString", coordinates: [[124.6578, 8.4647], [124.6579, 8.4648]] },
    legs: [{ steps: [{ distance: 20, name: "Cemetery path", maneuver: { type: "turn", modifier: "left" } }] }],
  }],
};

function onlyPrimaryViewport(testInfo) {
  test.skip(testInfo.project.name !== "portrait-375", "Focused kiosk journey runs once.");
}

async function mockSearch(page) {
  await page.route("**/api/graves?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ exact: [grave], suggestions: [], nearby: [], matchType: "graveId" }),
  }));
}

// The kiosk is a fixed on-site screen: every route starts at the configured
// start point (default: CMP Admin Office), never at browser geolocation.
const KIOSK_START = { lat: 8.4661065, lng: 124.65747 };
const ROUTE_BUTTON = /Show route from CMP Admin Office/;

test("kiosk deep-link selects a grave and routes from the admin office", async ({ page }, testInfo) => {
  onlyPrimaryViewport(testInfo);
  await mockSearch(page);

  let navigationLogs = 0;
  await page.route("**/api/navigation", (route) => {
    navigationLogs += 1;
    return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/routing", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.origin).toEqual(KIOSK_START);
    expect(body.destination).toEqual({ lat: 8.4648, lng: 124.6579 });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(routeResponse) });
  });

  await page.goto("/kiosk?grave=42", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("kiosk-selection")).toContainText("Maria Santos");
  await page.getByRole("button", { name: ROUTE_BUTTON }).click();
  await expect(page.getByText("✓ Route from CMP Admin Office")).toBeVisible();
  await expect(page.getByRole("list", { name: "Step-by-step directions" })).toBeVisible();
  expect(navigationLogs).toBe(0);
});

test("kiosk never asks the browser for the visitor's location", async ({ page }, testInfo) => {
  onlyPrimaryViewport(testInfo);
  await mockSearch(page);
  await page.addInitScript(() => {
    window.__geoCalls = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: () => { window.__geoCalls += 1; } },
    });
  });
  await page.route("**/api/routing", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(routeResponse) }));

  await page.goto("/kiosk?grave=42", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("kiosk-selection")).toContainText("Maria Santos");
  await page.getByRole("button", { name: ROUTE_BUTTON }).click();
  await expect(page.getByText("✓ Route from CMP Admin Office")).toBeVisible();
  expect(await page.evaluate(() => window.__geoCalls)).toBe(0);
});

test("kiosk can retry after a routing provider failure", async ({ page }, testInfo) => {
  onlyPrimaryViewport(testInfo);
  await mockSearch(page);
  let attempts = 0;
  await page.route("**/api/routing", (route) => {
    attempts += 1;
    return route.fulfill(attempts === 1
      ? { status: 503, contentType: "application/json", body: JSON.stringify({ error: { type: "ROUTING_UNAVAILABLE", message: "Routing is temporarily unavailable." } }) }
      : { status: 200, contentType: "application/json", body: JSON.stringify(routeResponse) });
  });

  await page.goto("/kiosk?grave=42", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("kiosk-selection")).toBeVisible();
  await page.getByRole("button", { name: ROUTE_BUTTON }).click();
  await expect(page.locator("p[role='alert']")).toContainText("temporarily unavailable");
  await page.getByRole("button", { name: ROUTE_BUTTON }).click();
  await expect(page.getByText("✓ Route from CMP Admin Office")).toBeVisible();
  expect(attempts).toBe(2);
});


test("kiosk clears private state after inactivity", async ({ page }, testInfo) => {
  onlyPrimaryViewport(testInfo);
  await page.clock.install();
  await mockSearch(page);
  await page.goto("/kiosk?grave=42", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("kiosk-selection")).toBeVisible();
  await page.clock.fastForward(120_100);
  await expect(page.getByTestId("kiosk-selection")).toHaveCount(0);
  await expect(page.getByLabel("Search records by name, ID, or plot")).toHaveValue("");
  await expect(page).toHaveURL(/\/kiosk$/);
});


test("kiosk blocks routing when a grave has no GPS coordinates", async ({ page }, testInfo) => {
  onlyPrimaryViewport(testInfo);
  const missingGps = { ...grave, plot: { ...grave.plot, gpsLat: null, gpsLng: null } };
  await page.route("**/api/graves?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ exact: [missingGps], suggestions: [], nearby: [], matchType: "graveId" }),
  }));
  let routingCalls = 0;
  await page.route("**/api/routing", (route) => {
    routingCalls += 1;
    return route.abort();
  });
  await page.goto("/kiosk?grave=42", { waitUntil: "domcontentloaded" });
  // The record still shows, but no directions panel is offered at all.
  await expect(page.getByTestId("kiosk-selection")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use my location" })).toHaveCount(0);
  await expect(page.getByText("Directions unavailable — this plot has no GPS coordinates.")).toHaveCount(0);
  expect(routingCalls).toBe(0);
});