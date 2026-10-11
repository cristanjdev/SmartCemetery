/**
 * Navigation helpers (Requirement 12)
 *
 * Pure, dependency-free helpers for the step-by-step navigation overlay. This
 * module intentionally contains NO Prisma, React, or fetch usage so it can be
 * unit- and property-tested in isolation. The overlay UI and the
 * `/api/navigation` endpoint (task 19.4) consume these helpers.
 *
 * Two responsibilities:
 *   1. `formatRouteSteps(steps)` — turn OSRM route steps into a contiguously
 *      numbered, order-preserving instruction list (Req 12.2, Property 21).
 *   2. `hasValidCoordinates(plot)` / `evaluateNavigationGate({ origin, destination })`
 *      — block routing + logging when GPS coordinates are missing/invalid
 *      (Req 12.4, Property 22).
 */

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

/**
 * Format an ordered list of OSRM route steps into a contiguously numbered list.
 *
 * Input shape — a flattened, ordered array of OSRM route steps. In an OSRM
 * response a route has `legs`, each leg has `steps`; callers flatten those legs
 * (in leg order, then step order) before calling this function. Each step is
 * shaped like:
 *   {
 *     maneuver?: { type?: string, modifier?: string },
 *     name?: string,       // street/segment name ("" for unnamed segments)
 *     distance?: number,   // metres for this step
 *   }
 *
 * Output — a new array numbered 1..N with NO gaps, preserving source order
 * (Property 21):
 *   [{ step: 1, instruction: "..." }, { step: 2, instruction: "..." }, ...]
 *
 * Pure function: does not mutate the input.
 *
 * @param {Array<{ maneuver?: { type?: string, modifier?: string }, name?: string, distance?: number }>} steps
 * @returns {Array<{ step: number, instruction: string }>}
 */
export function formatRouteSteps(steps) {
  if (!Array.isArray(steps)) return [];

  return steps.map((rawStep, index) => ({
    step: index + 1,
    instruction: buildInstruction(rawStep),
  }));
}

/**
 * Build a human-readable instruction string for a single OSRM step.
 *
 * Combines the maneuver type + modifier ("turn left", "continue straight",
 * "arrive") with the segment name and distance when available. Always returns
 * a non-empty string so every numbered step has a description.
 *
 * @param {{ maneuver?: { type?: string, modifier?: string }, name?: string, distance?: number, instruction?: string }} rawStep
 * @returns {string}
 */
function buildInstruction(rawStep) {
  const step = rawStep && typeof rawStep === "object" ? rawStep : {};
  const distance =
    typeof step.distance === "number" && Number.isFinite(step.distance) && step.distance > 0
      ? ` (${formatDistance(step.distance)})`
      : "";

  // Steps through the cemetery aisles carry their own sentence.
  if (typeof step.instruction === "string" && step.instruction.trim()) {
    return step.instruction.trim() + distance;
  }

  const maneuver = step.maneuver && typeof step.maneuver === "object" ? step.maneuver : {};

  const type = typeof maneuver.type === "string" ? maneuver.type.trim() : "";
  const modifier = typeof maneuver.modifier === "string" ? maneuver.modifier.trim() : "";
  const name = typeof step.name === "string" ? step.name.trim() : "";

  // Base action from the maneuver, e.g. "Turn left", "Continue", "Arrive".
  const actionParts = [];
  if (type) actionParts.push(type);
  if (modifier) actionParts.push(modifier);
  let instruction = actionParts.join(" ").trim();
  if (!instruction) instruction = "Proceed";
  instruction = capitalize(instruction);

  // Add the segment name when present ("arrive" typically has no name).
  if (name) {
    instruction += type === "arrive" ? ` at ${name}` : ` onto ${name}`;
  }

  // Append the distance when it is a positive finite number.
  return instruction + distance;
}

/**
 * Format a distance in metres to a short human-readable string.
 * @param {number} metres
 * @returns {string}
 */
function formatDistance(metres) {
  if (metres >= 1000) {
    const km = metres / 1000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `${Math.round(metres)} m`;
}

/**
 * Capitalize the first character of a string.
 * @param {string} text
 * @returns {string}
 */
function capitalize(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Check whether a value is a finite number.
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Determine whether a coordinate pair is valid: both lat and lng must be finite
 * numbers within their geographic ranges (lat in [-90, 90], lng in [-180, 180]).
 *
 * @param {{ lat?: unknown, lng?: unknown }} coords
 * @returns {boolean}
 */
export function hasValidCoordinates(coords) {
  if (!coords || typeof coords !== "object") return false;
  const { lat, lng } = coords;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return false;
  if (lat < LAT_MIN || lat > LAT_MAX) return false;
  if (lng < LNG_MIN || lng > LNG_MAX) return false;
  return true;
}

/**
 * Evaluate the navigation gate before any routing or logging occurs (Req 12.4,
 * Property 22).
 *
 * Both `origin` and `destination` are coordinate pairs shaped `{ lat, lng }`.
 * The `destination` represents the selected grave's plot GPS coordinates.
 *
 * Outcome shape:
 *   - { ok: false, reason: "unavailable" } when the destination coordinates are
 *     missing/incomplete/non-finite/out-of-range — the caller MUST NOT generate
 *     a route and MUST NOT persist a Navigation_Log.
 *   - { ok: false, reason: "invalid-origin" } when the destination is valid but
 *     the supplied origin is missing/invalid — no route, no log.
 *   - { ok: true } when both origin and destination are valid finite coordinate
 *     pairs — routing (and logging on success) may proceed.
 *
 * Pure function: no I/O.
 *
 * @param {{ origin?: { lat?: unknown, lng?: unknown }, destination?: { lat?: unknown, lng?: unknown } }} params
 * @returns {{ ok: true } | { ok: false, reason: "unavailable" | "invalid-origin" }}
 */
export function evaluateNavigationGate({ origin, destination } = {}) {
  // Missing destination GPS is the primary blocking case (Req 12.4).
  if (!hasValidCoordinates(destination)) {
    return { ok: false, reason: "unavailable" };
  }

  if (!hasValidCoordinates(origin)) {
    return { ok: false, reason: "invalid-origin" };
  }

  return { ok: true };
}
