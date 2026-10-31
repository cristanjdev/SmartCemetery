/**
 * Keyboard navigation for the 3D map (pure — no React, no three.js).
 *
 * Held keys become movement "actions"; `stepView` moves the camera view by
 * one frame of those actions, so holding a key moves smoothly:
 *
 *   Arrows / W A S D       move around the cemetery
 *   Shift + ← →, Q / E     turn the view left / right
 *   Shift + ↑ ↓, R / F     tilt toward a top view / toward the horizon
 *   + / -, Page Up / Down  zoom in / out
 *
 * A view is { target: {x, z}, distance, polar, azimuth } around the point
 * the camera looks at (scene frame: x east, z south; azimuth 0 = camera south
 * of the target looking north).
 */

export const VIEW_LIMITS = { minDistance: 6, maxDistance: 650, minPolar: 0.05, maxPolar: 1.25 };

/** Ground metres per second, as a share of the camera distance. */
const MOVE_RATE = 0.45;
/** Radians per second. */
const TURN_RATE = 0.9;
const TILT_RATE = 0.6;
/** Distance multiplier per second while zooming. */
const ZOOM_RATE = 1.8;
/** How quickly speed follows the keys (per second): eases in on press and out on release. */
const RESPONSE = 7;
/** Longest frame step used, so a slow or stalled frame never jumps the view. */
export const MAX_STEP_S = 1 / 20;

const AXES = ["forward", "right", "turn", "tilt", "zoom"];
export const STILL = Object.freeze({ forward: 0, right: 0, turn: 0, tilt: 0, zoom: 0 });

const MOVE_KEYS = {
  ArrowUp: [1, 0],
  KeyW: [1, 0],
  ArrowDown: [-1, 0],
  KeyS: [-1, 0],
  ArrowLeft: [0, -1],
  KeyA: [0, -1],
  ArrowRight: [0, 1],
  KeyD: [0, 1],
};

/** Every key the map listens to (so the page can stop them scrolling it). */
export const MAP_KEY_CODES = new Set([
  ...Object.keys(MOVE_KEYS),
  "KeyQ",
  "KeyE",
  "KeyR",
  "KeyF",
  "Equal",
  "NumpadAdd",
  "Minus",
  "NumpadSubtract",
  "PageUp",
  "PageDown",
]);

/**
 * @param {Iterable<string>} held KeyboardEvent.code values currently held
 * @param {boolean} shift whether Shift is held
 * @returns {{ forward: number, right: number, turn: number, tilt: number, zoom: number }}
 *   each -1, 0 or 1 (or a sum of opposing keys)
 */
export function keyActions(held, shift = false) {
  const a = { forward: 0, right: 0, turn: 0, tilt: 0, zoom: 0 };
  for (const code of held) {
    const isArrow = code.startsWith("Arrow");
    if (shift && isArrow) {
      // Shift turns the arrows into rotate (left/right) and tilt (up/down).
      if (code === "ArrowLeft") a.turn -= 1;
      if (code === "ArrowRight") a.turn += 1;
      if (code === "ArrowUp") a.tilt -= 1;
      if (code === "ArrowDown") a.tilt += 1;
      continue;
    }
    if (MOVE_KEYS[code]) {
      a.forward += MOVE_KEYS[code][0];
      a.right += MOVE_KEYS[code][1];
    }
    if (code === "KeyQ") a.turn -= 1;
    if (code === "KeyE") a.turn += 1;
    if (code === "KeyR") a.tilt -= 1;
    if (code === "KeyF") a.tilt += 1;
    if (code === "Equal" || code === "NumpadAdd" || code === "PageUp") a.zoom += 1;
    if (code === "Minus" || code === "NumpadSubtract" || code === "PageDown") a.zoom -= 1;
  }
  return a;
}

export function hasMotion(a) {
  return Boolean(a.forward || a.right || a.turn || a.tilt || a.zoom);
}

/**
 * Moves the current speed toward the keys' speed, so movement eases in when a
 * key goes down and glides to a stop when it is released (a quick tap moves
 * a little, not a full step). Tiny leftovers snap to zero so the loop can rest.
 */
export function easeActions(current, target, dt) {
  const k = 1 - Math.exp(-RESPONSE * dt);
  const next = {};
  for (const axis of AXES) {
    const v = current[axis] + (target[axis] - current[axis]) * k;
    next[axis] = target[axis] === 0 && Math.abs(v) < 0.01 ? 0 : v;
  }
  return next;
}

/** The view after `dt` seconds of the given actions. */
export function stepView(view, a, dt, limits = VIEW_LIMITS) {
  const { azimuth } = view;
  // Screen "up" on the ground is from the camera toward the target.
  const fx = -Math.sin(azimuth);
  const fz = -Math.cos(azimuth);
  const rx = Math.cos(azimuth);
  const rz = -Math.sin(azimuth);
  const step = view.distance * MOVE_RATE * dt;
  const target = {
    x: view.target.x + (fx * a.forward + rx * a.right) * step,
    z: view.target.z + (fz * a.forward + rz * a.right) * step,
  };
  // Turning right swings the camera round to the left of the target.
  const nextAzimuth = azimuth - a.turn * TURN_RATE * dt;
  const polar = Math.min(limits.maxPolar, Math.max(limits.minPolar, view.polar + a.tilt * TILT_RATE * dt));
  const distance = Math.min(
    limits.maxDistance,
    Math.max(limits.minDistance, view.distance * Math.pow(ZOOM_RATE, -a.zoom * dt))
  );
  return { target, distance, polar, azimuth: nextAzimuth };
}
