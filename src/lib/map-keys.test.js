import { describe, it, expect } from "vitest";
import { easeActions, hasMotion, keyActions, stepView, STILL, VIEW_LIMITS } from "./map-keys";

const VIEW = { target: { x: 0, z: 0 }, distance: 100, polar: 0.7, azimuth: 0 };

describe("map keys", () => {
  it("turns arrows into movement, and into turn/tilt with Shift", () => {
    expect(keyActions(["ArrowUp", "ArrowLeft"])).toMatchObject({ forward: 1, right: -1, turn: 0 });
    expect(keyActions(["ArrowLeft"], true)).toMatchObject({ forward: 0, right: 0, turn: -1 });
    expect(keyActions(["ArrowUp"], true)).toMatchObject({ forward: 0, tilt: -1 });
    expect(keyActions(["KeyE", "Equal"])).toMatchObject({ turn: 1, zoom: 1 });
    expect(hasMotion(keyActions(["KeyX"]))).toBe(false);
  });

  it("moves toward the top of the screen (north when the camera faces north)", () => {
    const next = stepView(VIEW, keyActions(["ArrowUp"]), 1);
    expect(next.target.z).toBeLessThan(0);
    expect(next.target.x).toBeCloseTo(0, 6);
  });

  it("moves right as seen on screen, whichever way the camera faces", () => {
    const facingSouth = { ...VIEW, azimuth: Math.PI };
    const next = stepView(facingSouth, keyActions(["ArrowRight"]), 1);
    // Looking south, screen-right is west.
    expect(next.target.x).toBeLessThan(0);
  });

  it("keeps tilt and zoom inside the limits", () => {
    const tilted = stepView(VIEW, keyActions(["KeyF"]), 10);
    expect(tilted.polar).toBe(VIEW_LIMITS.maxPolar);
    const zoomedOut = stepView(VIEW, keyActions(["Minus"]), 30);
    expect(zoomedOut.distance).toBe(VIEW_LIMITS.maxDistance);
    const zoomedIn = stepView(VIEW, keyActions(["Equal"]), 30);
    expect(zoomedIn.distance).toBe(VIEW_LIMITS.minDistance);
  });

  it("eases in on press and glides to a full stop on release", () => {
    const press = keyActions(["ArrowUp"]);
    const first = easeActions(STILL, press, 1 / 60);
    // One frame after the press: only a small part of full speed, not a jump.
    expect(first.forward).toBeGreaterThan(0);
    expect(first.forward).toBeLessThan(0.2);
    let v = first;
    for (let i = 0; i < 60; i++) v = easeActions(v, press, 1 / 60);
    expect(v.forward).toBeGreaterThan(0.95);
    for (let i = 0; i < 120; i++) v = easeActions(v, STILL, 1 / 60);
    expect(hasMotion(v)).toBe(false);
  });

  it("moves only a little for a quick tap", () => {
    const press = keyActions(["ArrowUp"]);
    let v = STILL;
    let view = VIEW;
    // ~0.1 s held, then released: a few metres at 100 m distance (glide included),
    // where a single stalled frame used to jump about 22 m.
    for (let i = 0; i < 6; i++) {
      v = easeActions(v, press, 1 / 60);
      view = stepView(view, v, 1 / 60);
    }
    for (let i = 0; i < 120; i++) {
      v = easeActions(v, STILL, 1 / 60);
      view = stepView(view, v, 1 / 60);
    }
    expect(Math.abs(view.target.z)).toBeLessThan(6);
  });

  it("turns the view", () => {
    const next = stepView(VIEW, keyActions(["KeyE"]), 0.5);
    expect(next.azimuth).not.toBe(0);
  });
});
