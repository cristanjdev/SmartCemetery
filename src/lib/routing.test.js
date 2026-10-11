import { describe, expect, it, vi } from "vitest";
import {
  getServerRoutingConfig,
  requestRoute,
  RoutingServiceError,
  validateRoutingRequest,
} from "@/lib/routing";
import { buildWalkwayNetwork } from "@/lib/walkways";

const origin = { lat: 8.4647, lng: 124.6578 };
const destination = { lat: 8.4648, lng: 124.6579 };
const config = {
  baseUrl: "https://routing.example.test",
  profile: "foot",
  timeoutMs: 1000,
  radiusMeters: 1000,
  center: origin,
};

function providerResponse() {
  return {
    ok: true,
    json: async () => ({
      code: "Ok",
      routes: [{
        geometry: { coordinates: [[origin.lng, origin.lat], [destination.lng, destination.lat]] },
        distance: 25,
        duration: 15,
        legs: [{ steps: [{ distance: 25, name: "Path", maneuver: { type: "turn", modifier: "left" } }] }],
      }],
    }),
  };
}

describe("routing service", () => {
  it("strictly rejects malformed coordinates", () => {
    expect(() => validateRoutingRequest({ origin: { lat: "8", lng: 124 }, destination }))
      .toThrow(RoutingServiceError);
    expect(() => validateRoutingRequest({ origin: { ...origin, accuracy: 4 }, destination }))
      .toThrowError(expect.objectContaining({ status: 400, code: "INVALID_COORDINATES" }));
  });

  it("uses server-only routing variables", () => {
    const resolved = getServerRoutingConfig({
      NODE_ENV: "production",
      ROUTING_BASE_URL: "https://routing.example.test/",
      ROUTING_PROFILE: "foot",
      NEXT_PUBLIC_ROUTING_BASE_URL: "https://ignored.example.test",
      MAP_CENTER_LAT: String(origin.lat),
      MAP_CENTER_LNG: String(origin.lng),
    });
    expect(resolved.baseUrl).toBe("https://routing.example.test");
    expect(resolved.profile).toBe("foot");
  });

  it("guards the configured cemetery radius before provider access", async () => {
    const fetchImpl = vi.fn();
    await expect(requestRoute({ origin, destination: { lat: 9, lng: 125 } }, { config, fetchImpl }))
      .rejects.toMatchObject({ status: 400, code: "OUTSIDE_CEMETERY_AREA" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a safe OSRM-compatible route and passes an AbortSignal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providerResponse());
    const result = await requestRoute({ origin, destination }, { config, fetchImpl });
    expect(result.code).toBe("Ok");
    expect(result.routes[0].geometry.coordinates).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "routing.example.test" }),
      expect.objectContaining({ signal: expect.any(AbortSignal), cache: "no-store" })
    );
  });

  it.each([
    [new DOMException("timed out", "TimeoutError"), 504, "ROUTING_TIMEOUT"],
    [new Error("network details"), 502, "ROUTING_PROVIDER_ERROR"],
  ])("maps provider failures to safe typed errors", async (providerError, status, code) => {
    const fetchImpl = vi.fn().mockRejectedValue(providerError);
    await expect(requestRoute({ origin, destination }, { config, fetchImpl }))
      .rejects.toMatchObject({ status, code });
  });

  it("maps provider unavailability to 503 without leaking response content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(requestRoute({ origin, destination }, { config, fetchImpl }))
      .rejects.toMatchObject({ status: 503, code: "ROUTING_UNAVAILABLE" });
  });

  describe("with the cemetery rows", () => {
    const lngM = 111320 * Math.cos((destination.lat * Math.PI) / 180);
    const at = (x, y) => ({ lat: destination.lat + y / 110574, lng: destination.lng + x / lngM });
    // Two east-west rows; the plot sits in the north one, the gate is south.
    const row = (key, y) =>
      Array.from({ length: 10 }, (_, i) => ({ key, ...at(-12 + i * 2.65, y) }));
    const walkways = buildWalkwayNetwork([...row("A", 0), ...row("B", -10)]);
    const gate = { ...at(0, -20), label: "Main Gate" };
    const withGate = { ...config, entrance: gate };

    it("walks an on-site visitor around the rows without the road provider", async () => {
      const fetchImpl = vi.fn();
      const result = await requestRoute(
        { origin: { lat: gate.lat, lng: gate.lng }, destination },
        { config: withGate, fetchImpl, walkways }
      );
      const route = result.routes[0];
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(route.geometry.coordinates.length).toBeGreaterThan(2);
      expect(route.distance).toBeGreaterThan(30);
      const steps = route.legs[0].steps.map((step) => step.instruction);
      expect(steps[0]).toMatch(/^From the Main Gate, head /);
      expect(steps[steps.length - 1]).toMatch(/^Arrive at the plot/);
    });

    it("routes a visitor from outside by road to the entrance, then on foot", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(providerResponse());
      const far = { lat: 8.47, lng: 124.66 };
      const result = await requestRoute({ origin: far, destination }, { config: withGate, fetchImpl, walkways });
      const requested = fetchImpl.mock.calls[0][0].pathname;
      expect(requested).toContain(`${far.lng},${far.lat};${gate.lng},${gate.lat}`);
      const steps = result.routes[0].legs[0].steps;
      expect(steps[0]).toMatchObject({ name: "Path" });
      expect(steps.some((step) => /^From the Main Gate/.test(step.instruction ?? ""))).toBe(true);
      expect(result.routes[0].distance).toBeGreaterThan(25);
    });
  });
});
