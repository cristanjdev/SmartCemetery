import { describe, it, expect } from "vitest";
import { arrivalAt, bearingDeg, distanceM, distanceToCemetery, formatDistance, readFix } from "./live-location";
import { SITE_ORIGIN } from "./site-surroundings";
import { toLatLng } from "./scene-layout";

// Points given in metres from SITE_ORIGIN (x east, z south).
const at = (x, z) => toLatLng(SITE_ORIGIN, { x, z });
const fix = ({ lat, lng }, accuracy = 8, heading = null) => ({ coords: { latitude: lat, longitude: lng, accuracy, heading } });
const INSIDE = at(0, 0);
const ADMIN_OFFICE = { lat: 8.4661065, lng: 124.65747 };

describe("live location", () => {
  it("measures distance and compass bearing", () => {
    const north = { lat: INSIDE.lat + 0.0001, lng: INSIDE.lng };
    expect(distanceM(INSIDE, north)).toBeCloseTo(11.1, 0);
    expect(bearingDeg(INSIDE, north)).toBeCloseTo(0, 0);
    expect(bearingDeg(INSIDE, { lat: INSIDE.lat, lng: INSIDE.lng + 0.0001 })).toBeCloseTo(90, 0);
  });

  it("knows the cemetery grounds, including the Admin Office at the gate", () => {
    expect(distanceToCemetery(INSIDE)).toBe(0);
    expect(distanceToCemetery(ADMIN_OFFICE)).toBeLessThan(25);
    expect(distanceToCemetery(at(400, 0))).toBeGreaterThan(300);
  });

  it("moves the walker only for an accurate fix at the cemetery", () => {
    expect(readFix(fix(INSIDE)).position).toMatchObject({ lat: INSIDE.lat, lng: INSIDE.lng, accuracy: 8 });
    expect(readFix(fix(ADMIN_OFFICE)).position).toBeTruthy();
  });

  it("says how far away a visitor who is not at the cemetery yet is", () => {
    const out = readFix(fix(at(1500, 0)));
    expect(out.rejected).toBe("away");
    expect(out.distanceM).toBeGreaterThan(1400);
    // A rough network guess far away still counts as away, not just inaccurate.
    expect(readFix(fix(at(3000, 0), 900)).rejected).toBe("away");
  });

  it("waits for a better fix when the signal is rough on site", () => {
    expect(readFix(fix(INSIDE, 120))).toEqual({ rejected: "inaccurate" });
    expect(readFix({ coords: {} })).toEqual({ rejected: "invalid" });
  });

  it("faces the way the visitor walked, and ignores GPS jitter", () => {
    const start = { ...INSIDE, heading: null };
    const walkedWest = readFix(fix({ lat: INSIDE.lat, lng: INSIDE.lng - 0.0001 }), start).position;
    expect(walkedWest.heading).toBeCloseTo(270, 0);
    const jitter = readFix(fix({ lat: walkedWest.lat + 0.000005, lng: walkedWest.lng }), walkedWest).position;
    expect(jitter.heading).toBeCloseTo(270, 0);
    expect(readFix(fix(INSIDE, 8, 45), start).position.heading).toBe(45);
  });

  it("detects arrival at the plot without flickering at the edge", () => {
    const plot = at(0, 0);
    const near = { ...at(0, 5), accuracy: 5 };
    const edge = { ...at(0, 11), accuracy: 5 };
    expect(arrivalAt({ ...at(0, 30), accuracy: 5 }, plot)).toMatchObject({ arrived: false, distanceM: 30 });
    expect(arrivalAt(near, plot).arrived).toBe(true);
    // 11 m: not yet arrived coming in, still arrived going out.
    expect(arrivalAt(edge, plot, false).arrived).toBe(false);
    expect(arrivalAt(edge, plot, true).arrived).toBe(true);
  });

  it("formats distances", () => {
    expect(formatDistance(42.4)).toBe("42 m");
    expect(formatDistance(1430)).toBe("1.4 km");
    expect(formatDistance(23000)).toBe("23 km");
  });
});
