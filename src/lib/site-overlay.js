/**
 * The park as the 3D map draws it, for the 2D (Google) map (pure).
 *
 * Both maps show the same things: the mapped rows (from the plots) and the
 * directory blocks and buildings traced from the drone photo. The blocks
 * that have no plots yet are placed with the same rule as in 3D, so a block
 * the Admin maps later stops being drawn here as soon as its row exists.
 */
import { buildSceneLayout, toLatLng } from "./scene-layout";
import { LAYOUT_PRESET } from "./layout-preset";
import { SITE_ORIGIN, SURROUNDINGS, placeUnmappedBlocks, rectCorners } from "./site-surroundings";
import { DEFAULT_GRID_ANGLE_DEG } from "./config";
import { coordsToBoundaryOffsets, getBoundaryCoords, getBuildingsCenter } from "./map-geometry";
import { isBuildingPlot } from "./cemetery-layout";

/** How far outside the paved yard the drawn boundary runs: about where the wall stands. */
export const BOUNDARY_MARGIN_M = 3;

/**
 * The cemetery's outline for the 2D map: the paved yard traced from the drone
 * photo (the same outline the 3D map and the walking routes use), pushed
 * `margin` metres outward so the blocks along its edge sit fully inside. An
 * edge goes further out where a building of the cemetery (the commercial
 * building, the Admin Office) stands on it, so the line runs round the
 * building instead of through it.
 *
 * @returns {Array<{lat:number,lng:number}>}
 */
export function siteBoundaryPath(margin = BOUNDARY_MARGIN_M, site = SURROUNDINGS) {
  const yard = (site.yard || []).map(([x, z]) => ({ x, z }));
  if (yard.length < 3) return [];
  // Which way is "out" depends on the outline's winding.
  let area = 0;
  for (let i = 0; i < yard.length; i += 1) {
    const a = yard[i];
    const b = yard[(i + 1) % yard.length];
    area += a.x * b.z - b.x * a.z;
  }
  const out = area > 0 ? 1 : -1;
  const normal = (a, b) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (out * (b.z - a.z)) / len, z: (out * -(b.x - a.x)) / len };
  };
  // 1. The yard pushed out evenly (mitred corners, capped at sharp ones).
  const ring = yard.map((p, i) => {
    const n1 = normal(yard[(i - 1 + yard.length) % yard.length], p);
    const n2 = normal(p, yard[(i + 1) % yard.length]);
    const mx = n1.x + n2.x;
    const mz = n1.z + n2.z;
    const ml = Math.hypot(mx, mz) || 1;
    const reach = Math.min(2 * margin, margin / Math.max(0.2, (mx / ml) * n1.x + (mz / ml) * n1.z));
    return { x: p.x + (mx / ml) * reach, z: p.z + (mz / ml) * reach };
  });
  // 2. Round the buildings that stand on the edge: their corners (with the
  // same margin) that fall outside become extra points on the nearest edge.
  const inside = (q) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if (a.z > q.z !== b.z > q.z && q.x < ((b.x - a.x) * (q.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
    }
    return hit;
  };
  const extra = ring.map(() => []);
  for (const b of site.buildings || []) {
    for (const c of rectCorners({ ...b, length: b.length + 2 * margin, width: b.width + 2 * margin })) {
      if (inside(c)) continue;
      let best = null;
      ring.forEach((a, i) => {
        const e = ring[(i + 1) % ring.length];
        const len2 = (e.x - a.x) ** 2 + (e.z - a.z) ** 2 || 1;
        const t = ((c.x - a.x) * (e.x - a.x) + (c.z - a.z) * (e.z - a.z)) / len2;
        if (t < 0 || t > 1) return;
        const d = Math.hypot(c.x - (a.x + (e.x - a.x) * t), c.z - (a.z + (e.z - a.z) * t));
        if (d < 25 && (!best || d < best.d)) best = { i, t, d };
      });
      if (best) extra[best.i].push({ ...c, t: best.t });
    }
  }
  const path = [];
  ring.forEach((p, i) => {
    path.push(p);
    for (const c of extra[i].sort((u, v) => u.t - v.t)) path.push(c);
  });
  return path.map((q) => toLatLng(SITE_ORIGIN, q));
}

/**
 * The fitted outline as boundary offsets (what the map draws and the Admin
 * edits), relative to the building plots' centre; null when there are none.
 */
export function siteBoundaryOffsets(plots, gridAngle = DEFAULT_GRID_ANGLE_DEG) {
  const center = getBuildingsCenter(plots);
  const path = siteBoundaryPath();
  if (!center || path.length < 3) return null;
  return coordsToBoundaryOffsets(path, center.lat, center.lng, gridAngle ?? DEFAULT_GRID_ANGLE_DEG);
}

function insidePolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Building plots that a saved boundary leaves outside (e.g. one drawn before
 * more rows were mapped). Empty when it fits every plot.
 */
export function plotsOutsideBoundary(offsets, plots, gridAngle = DEFAULT_GRID_ANGLE_DEG) {
  const center = getBuildingsCenter(plots);
  if (!center || !Array.isArray(offsets) || offsets.length < 3) return [];
  const poly = getBoundaryCoords(center.lat, center.lng, gridAngle ?? DEFAULT_GRID_ANGLE_DEG, offsets);
  return (plots || []).filter(
    (p) =>
      isBuildingPlot(p) &&
      p.gpsLat != null &&
      p.gpsLng != null &&
      !insidePolygon({ lat: Number(p.gpsLat), lng: Number(p.gpsLng) }, poly)
  );
}

/** Turns an angle so text drawn along it never reads upside down. */
function uprightDeg(deg) {
  let a = ((deg % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  return a > 180 ? a - 360 : a;
}

/**
 * @returns {{
 *   blocks: Array<{ name: string, path: {lat:number,lng:number}[], center: {lat:number,lng:number}, angleDeg: number }>,
 *   buildings: Array<{ name: string, path: {lat:number,lng:number}[], center: {lat:number,lng:number}, angleDeg: number }>
 * }} blocks without plots yet, and the buildings, as GPS polygons
 */
export function siteOverlay({ plots = [], preset = LAYOUT_PRESET, gridAngle = DEFAULT_GRID_ANGLE_DEG } = {}) {
  const layout = buildSceneLayout({ plots, preset, gridAngle });
  const ref = layout.ref;
  const blocks = ref
    ? placeUnmappedBlocks(ref, layout.blocks).map((b) => ({
        name: b.name,
        path: b.corners.map((c) => toLatLng(ref, c)),
        center: toLatLng(ref, b.center),
        angleDeg: uprightDeg((b.rotationY * 180) / Math.PI),
      }))
    : [];
  const buildings = (SURROUNDINGS.buildings || []).map((b) => ({
    name: b.label,
    path: rectCorners(b).map((c) => toLatLng(SITE_ORIGIN, c)),
    center: toLatLng(SITE_ORIGIN, { x: b.x, z: b.z }),
    angleDeg: uprightDeg(b.angleDeg || 0),
  }));
  return { blocks, buildings };
}
