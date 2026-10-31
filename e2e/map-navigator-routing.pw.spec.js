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

// Once the route is drawn the panel stays as it was: no confirmation line and
// no step list; screen readers hear a short status instead.
async function expectRouteOnMapOnly(page) {
  await expect(page.getByRole("status").filter({ hasText: "The walking route is shown on the map." })).toHaveCount(1);
  await expect(page.getByText("✓ Route from CMP Admin Office")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Step-by-step directions" })).toHaveCount(0);
}

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

  await page.goto("/map?grave=42", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("kiosk-selection")).toContainText("Maria Santos");
  // Opened from "Map Route": the route is drawn without another click.
  await expectRouteOnMapOnly(page);
  expect(navigationLogs).toBe(0);
});

test("says when the visitor is not at the cemetery yet", async ({ page }, testInfo) => {
  onlyPrimaryViewport(testInfo);
  await mockSearch(page);
  // A phone about 5 km away.
  await page.addInitScript((here) => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: () => {},
        watchPosition: (ok) => {
          setTimeout(() => ok({ coords: { latitude: here.lat + 0.045, longitude: here.lng, accuracy: 10, heading: null } }), 50);
          return 1;
        },
        clearWatch: () => {},
      },
    });
  }, KIOSK_START);
  await page.route("**/api/routing", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(routeResponse) }));
  await page.goto("/map?grave=42", { waitUntil: "domcontentloaded" });
  await expectRouteOnMapOnly(page);
  await expect(page.getByText(/Not at the cemetery yet · \d+(\.\d)? km away/)).toBeVisible();
});

test("live GPS moves the walker but never changes where the route starts", async ({ page }, testInfo) => {
  onlyPrimaryViewport(testInfo);
  await mockSearch(page);
  // A phone standing inside the cemetery, a few metres from the admin office.
  await page.addInitScript((here) => {
    window.__geo = { current: 0, watches: 0 };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: () => { window.__geo.current += 1; },
        watchPosition: (ok) => {
          window.__geo.watches += 1;
          setTimeout(() => ok({ coords: { latitude: here.lat, longitude: here.lng - 0.0001, accuracy: 6, heading: null } }), 50);
          return 1;
        },
        clearWatch: () => {},
      },
    });
  }, KIOSK_START);
  await page.route("**/api/routing", (route) => {
    expect(route.request().postDataJSON().origin).toEqual(KIOSK_START);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(routeResponse) });
  });

  await page.goto("/map?grave=42", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("kiosk-selection")).toContainText("Maria Santos");
  // The linked grave's route is drawn on arrival; only then is location watched.
  await expectRouteOnMapOnly(page);
  await expect(page.getByText(/On your way|arrived at the plot/)).toBeVisible();
  expect(await page.evaluate(() => window.__geo)).toEqual({ current: 0, watches: 1 });
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

  await page.goto("/map?grave=42", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("kiosk-selection")).toBeVisible();
  // The automatic first attempt fails; the button tries again.
  await expect(page.locator("p[role='alert']")).toContainText("temporarily unavailable");
  await page.getByRole("button", { name: ROUTE_BUTTON }).click();
  await expectRouteOnMapOnly(page);
  expect(attempts).toBe(2);
});


test("the map never clears a visitor's selection on its own", async ({ page }, testInfo) => {
  onlyPrimaryViewport(testInfo);
  // There is no shared kiosk screen, so nothing resets after inactivity, on any screen size.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.install();
  await mockSearch(page);
  await page.goto("/map?grave=42", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("kiosk-selection")).toBeVisible();
  await page.clock.fastForward(300_000);
  await expect(page.getByTestId("kiosk-selection")).toBeVisible();
  await expect(page).toHaveURL(/\/map\?grave=42$/);
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
  await page.goto("/map?grave=42", { waitUntil: "domcontentloaded" });
  // The record still shows, with a note instead of a directions panel.
  await expect(page.getByTestId("kiosk-selection")).toBeVisible();
  await expect(page.getByRole("note")).toContainText("not on the map yet");
  await expect(page.getByRole("button", { name: ROUTE_BUTTON })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use my location" })).toHaveCount(0);
  await expect(page.getByText("Directions unavailable — this plot has no GPS coordinates.")).toHaveCount(0);
  expect(routingCalls).toBe(0);
});