/**
 * Live "you are here" position for the public map (pure — no React, no I/O).
 *
 * The phone's GPS moves the walker only once the visitor is at the cemetery:
 * inside the traced grounds or within REACH_MARGIN_M of their edge (the gate
 * and the Admin Office). Until then the walker stays at the route's start
 * and the map says how far away they are. Positions stay in the browser —
 * nothing here is sent or stored.
 */
import { SITE_ORIGIN, SURROUNDINGS } from "./site-surroundings";
import { toLocal } from "./scene-layout";

/** A fix must be at least this accurate (metres) to place the visitor on the map. */
export const MAX_ACCURACY_M = 50;
/** How far outside the cemetery grounds still counts as "at the cemetery" (gate, office). */
export const REACH_MARGIN_M = 25;
/** Movement shorter than this is GPS jitter, not a step (for the walking direction). */
export const MIN_STEP_M = 2;
/** Arrived when this close to the plot (or the fix's accuracy, up to ARRIVAL_MAX_M). */
export const ARRIVAL_M = 8;
export const ARRIVAL_MAX_M = 15;
/** Leaving again needs this much more distance, so the state does not flicker. */
export const ARRIVAL_HYSTERESIS_M = 6;

const EARTH_M = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres between two { lat, lng } points. */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing in degrees (0 = north, 90 = east) from `a` to `b`. */
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function insidePolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/** The cemetery grounds as { x, z } metres from SITE_ORIGIN. */
const GROUNDS = (SURROUNDINGS.yard || []).map(([x, z]) => ({ x, z }));

/** Metres from `point` to the cemetery grounds (0 when inside). */
export function distanceToCemetery(point, grounds = GROUNDS) {
  if (grounds.length < 3) return 0;
  const p = toLocal(SITE_ORIGIN, point);
  if (insidePolygon(p, grounds)) return 0;
  let best = Infinity;
  for (let i = 0; i < grounds.length; i += 1) {
    best = Math.min(best, distanceToSegment(p, grounds[i], grounds[(i + 1) % grounds.length]));
  }
  return best;
}

/**
 * Turns a browser fix into a map position, or says why it is not used.
 *
 * "away" when the visitor is clearly outside the cemetery (even allowing for
 * the fix's accuracy) — with how far; "inaccurate" when the fix is too rough
 * to place them on the map.
 *
 * @param {{ coords: { latitude: number, longitude: number, accuracy?: number, heading?: number|null } }} fix
 * @param {{ lat: number, lng: number, heading?: number|null } | null} previous the last position used
 * @returns {{ position: { lat: number, lng: number, accuracy: number, heading: number|null } }
 *   | { rejected: "away", distanceM: number } | { rejected: "inaccurate" | "invalid" }}
 */
export function readFix(fix, previous = null, grounds = GROUNDS) {
  const c = fix?.coords;
  const lat = Number(c?.latitude);
  const lng = Number(c?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { rejected: "invalid" };
  const accuracy = Number.isFinite(c.accuracy) ? c.accuracy : Infinity;
  const here = { lat, lng };

  const away = distanceToCemetery(here, grounds);
  if (away - (Number.isFinite(accuracy) ? accuracy : 0) > REACH_MARGIN_M) {
    return { rejected: "away", distanceM: Math.round(away) };
  }
  if (accuracy > MAX_ACCURACY_M) return { rejected: "inaccurate" };

  // Facing: the device's own heading while moving, else the direction of the
  // last real step, else whatever it was before.
  let heading = Number.isFinite(c.heading) && c.heading !== null ? c.heading : null;
  if (heading === null && previous) {
    heading = distanceM(previous, here) >= MIN_STEP_M ? bearingDeg(previous, here) : previous.heading ?? null;
  }
  return { position: { lat, lng, accuracy, heading } };
}

/**
 * Whether the visitor has reached the plot, with a little hysteresis so a
 * jittery fix at the edge does not flip it back and forth.
 *
 * @returns {{ arrived: boolean, distanceM: number }}
 */
export function arrivalAt(position, destination, wasArrived = false) {
  const d = distanceM(position, destination);
  const within = Math.min(ARRIVAL_MAX_M, Math.max(ARRIVAL_M, Number.isFinite(position.accuracy) ? position.accuracy : 0));
  const arrived = wasArrived ? d <= within + ARRIVAL_HYSTERESIS_M : d <= within;
  return { arrived, distanceM: Math.round(d) };
}

/** "850 m" / "1.4 km". */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return "";
  return m < 1000 ? `${Math.max(1, Math.round(m))} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
