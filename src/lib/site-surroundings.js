/**
 * The park around the mapped burial rows on the 3D map: the directory blocks
 * not yet in the system, the commercial building, comfort rooms, wall, roads,
 * tree cover and nearby houses.
 *
 * Traced from the client's aerial photo of City Memorial Park. The photo was
 * matched to the 12 mapped rows (a perspective fit with about 1.7 m average
 * error), so positions are close but not survey-accurate.
 *
 * Coordinates are metres east (x) and south (z) of SITE_ORIGIN, the centre of
 * the preset rows. Edit the numbers here to move things; nothing else needs
 * to change. `placeSurroundings` turns the areas into individual trees and
 * houses (pure and deterministic: the same layout on every load).
 */

import { toLatLng, toLocal } from "./scene-layout";

export const SITE_ORIGIN = { lat: 8.465784155833331, lng: 124.65703588583331 };

/**
 * Blocks traced from the drone photo (named as on the printed directory).
 * A block with no plots in the system is drawn so the map shows the whole
 * park; once its row exists (named the same, e.g. "FBN-B21") the row is
 * drawn instead. `ne` is the end nearest the commercial building, `sw` the
 * far end.
 *
 * The other 12 rows were surveyed with GPS: FBN B2–B6, B8–B12, B17 and B18.
 */
export const UNMAPPED_BLOCKS = [
  // Ends short of SBN B15, which continues on the same line past a small aisle.
  { name: "SBN B7", ne: [-18.0, -40.6], sw: [-30.6, -33.4] },
  { name: "FBN B16", ne: [43.0, -3.6], sw: [23.5, 5.0] },
  { name: "BBN B1", ne: [35.2, 12.8], sw: [4.1, 28.4] },
  { name: "FBN B21", ne: [37.1, 25.0], sw: [9.0, 36.9] },
  { name: "FBN B23", ne: [37.1, 37.9], sw: [14.5, 46.1] },
  { name: "FBN B22", ne: [12.8, 50.5], sw: [1.0, 54.5] },
  { name: "FBN B24", ne: [7.7, 38.7], sw: [-11.2, 47.9] },
  { name: "BBN B2", ne: [1.4, 30.5], sw: [-21.1, 41.6] },
  { name: "FBN B13", ne: [-22.5, -13.3], sw: [-36.8, -5.5] },
  { name: "SBN B14", ne: [-26.8, -22.4], sw: [-37.4, -16.8] },
  { name: "SBN B15", ne: [-31.7, -31.2], sw: [-41.3, -26.0] },
  { name: "FBN B19", ne: [-32.4, 30.0], sw: [-45.6, 34.1] },
  { name: "FBN B20", ne: [-36.9, 20.3], sw: [-55.9, 28.8] },
];

export const SURROUNDINGS = {
  buildings: [
    // The long two-storey building along the north side; `sections` are the
    // columbarium blocks along its front, from the east end (0) to the west end (1).
    // Set 3.5 m north of the photo trace (with the service road and the wall's end) to keep
    // the ~6 m walkway the photo shows between it and the front rows.
    { label: "Commercial Building", x: 2.1, z: -48.7, length: 83.5, width: 8.3, height: 6.5, angleDeg: -11.4,
      sections: [{ label: "CB6F-P1", at: 0.2 }, { label: "CB7F-P1", at: 0.55 }, { label: "CB8F-P1", at: 0.85 }] },
    { label: "Admin Building", sign: true, x: 50.6, z: -7.7, length: 10.5, width: 11.2, height: 3.4, angleDeg: -14.0 },
    { label: "Comfort Room", sign: true, x: 26.4, z: 53.2, length: 10.8, width: 7.2, height: 3, angleDeg: 30.0 },
    { label: "Comfort Room", sign: true, x: -38.7, z: -39.7, length: 11.6, width: 6.0, height: 3, angleDeg: 30.3 },
    { label: "Urn Niche", sign: true, x: -44.0, z: -48.4, length: 5.3, width: 3.2, height: 2.6, angleDeg: 18.8 },
  ],
  // The columbarium extension wall curving round the west side.
  walls: [
    { width: 1.6, height: 2.6, labels: [{ label: "CB9F-P1", x: -56.7, z: 13.1 }, { label: "CB8FP1-EXT", x: -50.1, z: -26.4 }],
      points: [
        [-70.0, 28.9], [-67.8, 23.2], [-61.3, 16.5], [-53.9, 9.1], [-48.8, 3.0], [-46.9, -4.2],
        [-45.3, -10.9], [-45.6, -17.9], [-49.3, -24.5], [-54.1, -32.0], [-55.4, -38.3], [-55.5, -44.1],
        [-50.9, -48.0], [-43.6, -50.9], [-40.9, -54.5],
      ] },
  ],
  roads: [
    // Bolonsiri Rd, just east of the photo.
    { width: 7, points: [[96, -170], [100, 0], [106, 170]] },
    // Road curving round the west side, outside the wall.
    { width: 6, points: [
      [-78.8, 30.1], [-72.5, 26.6], [-64.8, 20.8], [-56.9, 13.6], [-52.6, 6.6], [-51.1, -3.1],
      [-50.7, -11.3], [-53.2, -20.1], [-58.3, -28.6], [-62.2, -37.1], [-61.5, -45.6], [-54.7, -53.8],
      [-48.4, -59.5], [-41.7, -64.7], [-33.5, -69.6], [-27.8, -74.0],
    ] },
    // Road along the east side.
    { width: 6, points: [
      [47.1, 137.4], [49.5, 110.8], [52.0, 74.3], [54.9, 43.4], [57.4, 16.6], [59.8, -4.4],
      [60.9, -21.0], [61.9, -36.2], [65.9, -51.5], [70.3, -56.4],
    ] },
    // Lane to the parking at the north-east.
    { width: 5, points: [
      [47.1, 135.9], [69.9, 145.1], [86.2, 153.5],
    ] },
    // Service road behind the commercial building.
    { width: 8, points: [
      [52.9, -47.6], [-0.3, -57.4], [-36.9, -63.8], [-41.0, -68.1],
    ] },
  ],
  // The concrete yard the blocks stand on.
  yard: [
    [37.3, 69.8], [-69.4, 29.7], [-68.1, 23.7], [-60.9, 16.6], [-53.6, 8.7], [-48.5, 2.6],
    [-45.9, -7.5], [-45.3, -17.6], [-49.2, -24.9], [-54.0, -32.4], [-55.3, -38.7], [-55.3, -44.0],
    [-50.1, -48.4], [-41.0, -53.7], [49.8, -35.0], [51.1, -22.8], [47.5, -12.4], [45.2, -0.9],
    [43.9, 5.9], [43.7, 37.5], [41.9, 60.6],
  ],
  // Tree cover traced from the photo, then lighter fill beyond it.
  forests: [
    { spacing: 4.5, points: [
      [49.7, 190.8], [-117.9, 87.2], [-98.3, 36.3], [-90.6, 28.8], [-78.8, 32.3], [-70.1, 30.7],
      [34.7, 71.1], [43.8, 97.2], [44.7, 134.6],
    ] },
    { spacing: 4.5, points: [
      [-57.6, 12.9], [-68.8, 24.2], [-78.5, 29.3], [-93.2, 23.1], [-66.2, -51.7], [-58.9, -51.9],
      [-62.2, -44.7], [-62.1, -34.0], [-57.1, -26.6], [-52.3, -16.4], [-52.9, -3.6],
    ] },
    { spacing: 4.5, points: [
      [44.9, 108.6], [37.9, 69.7], [42.8, 37.2], [43.9, 5.9], [46.5, -2.9], [52.8, 1.6],
      [51.4, 52.3], [50.6, 98.0],
    ] },
    { spacing: 5, points: [
      [83.3, 114.9], [56.4, 105.0], [57.3, 44.2], [59.9, 29.2], [76.9, 31.4],
    ] },
    { spacing: 5, points: [
      [76.9, 31.4], [57.9, 27.0], [59.1, 3.3], [67.5, 5.5], [74.9, 4.8],
    ] },
    { spacing: 4.5, points: [
      [70.7, -51.0], [-6.8, -64.3], [-22.8, -67.4], [-32.9, -71.8], [-34.1, -75.0], [70.0, -59.1],
    ] },
    { spacing: 5, points: [
      [-55.4, -52.4], [-64.1, -52.5], [-54.3, -78.1], [-35.1, -75.2], [-45.3, -67.0],
    ] },
    { spacing: 7, points: [[110, -180], [240, -180], [240, 240], [112, 240]] },
    { spacing: 7, points: [[-115, 92], [-53, -76], [-240, -120], [-240, 240]] },
    { spacing: 7, points: [[95, 215], [-115, 92], [-120, 240], [100, 240]] },
  ],
  // Houses seen in the photo.
  houses: [
    { x: -39.9, z: 55.5, w: 6.0, d: 6.6, angleDeg: -24.2, roof: "#6b7f99" },
    { x: -63.5, z: 47.1, w: 5.0, d: 7.5, angleDeg: -24.3, roof: "#9b3d32" },
    { x: -67.7, z: 44.9, w: 3.3, d: 6.7, angleDeg: -23.9, roof: "#b9bec4" },
    { x: -84.8, z: 39.8, w: 5.3, d: 12.9, angleDeg: -24.1, roof: "#a5513b" },
    { x: -94.9, z: 32.8, w: 3.9, d: 6.3, angleDeg: -23.6, roof: "#9b3d32" },
    { x: -92.1, z: 26.6, w: 4.5, d: 5.6, angleDeg: -23.7, roof: "#3f8a86" },
    { x: -58.4, z: -58.4, w: 6.6, d: 10.7, angleDeg: -11.3, roof: "#7a4a3a" },
    { x: -42.5, z: -69.4, w: 10.9, d: 12.3, angleDeg: -9.5, roof: "#7a4a3a" },
    { x: -50.8, z: -62.4, w: 4.2, d: 4.8, angleDeg: -10.4, roof: "#8c5a44" },
    { x: -15.5, z: -63.8, w: 14.2, d: 7.8, angleDeg: -9.9, roof: "#9b4a3a" },
    { x: 12.9, z: -62.3, w: 6.6, d: 3.8, angleDeg: -10.0, roof: "#9b3d32" },
    { x: 67.2, z: 40.2, w: 13.6, d: 16.5, angleDeg: -18.0, roof: "#b84a3a" },
    { x: 70.1, z: 120.1, w: 31.1, d: 25.5, angleDeg: -25.2, roof: "#6f747c" },
  ],
  // More houses beyond the photo, scattered.
  houseAreas: [
    { points: [[75, -58], [-55, -78], [-60, -190], [100, -190]] },
    { points: [[115, -170], [200, -170], [200, 40], [116, 40]] },
  ],
};

// Back-to-back blocks: two 2.8 m faces, like the mapped rows.
export const UNMAPPED_BLOCK_WIDTH_M = 5.6;

/**
 * Rows whose plots were laid out from this tracing rather than surveyed with
 * GPS ("FBN B21" → row "FBN-B21"). Their angle is only as good as the photo,
 * so the 3D grid is fitted to the surveyed rows instead.
 */
export const TRACED_ROW_KEYS = new Set(UNMAPPED_BLOCKS.map((b) => b.name.trim().replace(/\s+/g, "-").toUpperCase()));

export const ROOF_COLORS = ["#9b3d32", "#6b7f99", "#b9bec4", "#3f5f8a", "#a5513b", "#8c939b"];

/**
 * What a walking route must go round besides the mapped rows: the directory
 * blocks not yet in the system and the buildings, as GPS rectangles (see
 * buildWalkwayNetwork). The same shapes the 3D map draws.
 */
export function routeObstacles(site = SURROUNDINGS, blocks = UNMAPPED_BLOCKS) {
  const blockRects = blocks.map((b) => {
    const [nx, nz] = b.ne;
    const [sx, sz] = b.sw;
    return {
      key: b.name,
      x: (nx + sx) / 2,
      z: (nz + sz) / 2,
      length: Math.hypot(nx - sx, nz - sz),
      width: UNMAPPED_BLOCK_WIDTH_M,
      angleDeg: (Math.atan2(-(nz - sz), nx - sx) * 180) / Math.PI,
    };
  });
  const buildingRects = (site.buildings || []).map((b) => ({
    key: b.label,
    x: b.x,
    z: b.z,
    length: b.length,
    width: b.width,
    angleDeg: b.angleDeg || 0,
  }));
  return [...blockRects, ...buildingRects].map(({ x, z, ...rect }) => ({
    ...rect,
    center: toLatLng(SITE_ORIGIN, { x, z }),
  }));
}

/** The cemetery grounds' outline (inside the outer wall) as GPS points, for walking routes. */
export function siteBoundary(site = SURROUNDINGS) {
  return (site.yard || []).map(([x, z]) => toLatLng(SITE_ORIGIN, { x, z }));
}

/** Moves a site point ([x, z] metres from SITE_ORIGIN) into a scene centred on `ref`. */
export function siteToScene(ref, [x, z]) {
  if (!ref) return { x, z };
  return toLocal(ref, toLatLng(SITE_ORIGIN, { x, z }));
}

/**
 * The directory blocks that are not yet in the system, in the scene frame.
 * A block that would overlap a mapped row is left out, so mapping it later
 * simply replaces the drawing.
 *
 * @param {object|null} ref scene centre
 * @param {Array<{ center: {x:number,z:number}, length: number, width: number, rotationY: number }>} mapped
 */
export function placeUnmappedBlocks(ref, mapped = [], blocks = UNMAPPED_BLOCKS) {
  const rects = mapped.map((b) => ({
    x: b.center.x,
    z: b.center.z,
    length: b.length,
    width: b.width,
    angleDeg: (b.rotationY * 180) / Math.PI,
  }));
  const out = [];
  for (const block of blocks) {
    const ne = siteToScene(ref, block.ne);
    const sw = siteToScene(ref, block.sw);
    // Same convention as the mapped rows: angle of the far-to-near direction, counter-clockwise from east.
    const rotationY = Math.atan2(-(ne.z - sw.z), ne.x - sw.x);
    const center = { x: (ne.x + sw.x) / 2, z: (ne.z + sw.z) / 2 };
    const rect = {
      x: center.x,
      z: center.z,
      length: Math.hypot(ne.x - sw.x, ne.z - sw.z),
      width: UNMAPPED_BLOCK_WIDTH_M,
      angleDeg: (rotationY * 180) / Math.PI,
    };
    if (rects.some((r) => rectsOverlap(r, rect))) continue;
    out.push({
      name: block.name,
      center,
      length: rect.length,
      width: rect.width,
      rotationY,
      corners: rectCorners(rect),
    });
  }
  return out;
}

export function rectCorners(r) {
  const rad = (r.angleDeg * Math.PI) / 180;
  const ax = Math.cos(rad);
  const az = -Math.sin(rad);
  const hl = r.length / 2;
  const hw = r.width / 2;
  return [
    [hl, hw],
    [hl, -hw],
    [-hl, -hw],
    [-hl, hw],
  ].map(([a, c]) => ({ x: r.x + a * ax + c * -az, z: r.z + a * az + c * ax }));
}

/** True when two rotated rectangles overlap (separating-axis test). */
export function rectsOverlap(a, b) {
  const ca = rectCorners(a);
  const cb = rectCorners(b);
  const axes = [a, b].flatMap((r) => {
    const rad = (r.angleDeg * Math.PI) / 180;
    return [
      { x: Math.cos(rad), z: -Math.sin(rad) },
      { x: Math.sin(rad), z: Math.cos(rad) },
    ];
  });
  return axes.every((axis) => {
    const pa = ca.map((p) => p.x * axis.x + p.z * axis.z);
    const pb = cb.map((p) => p.x * axis.x + p.z * axis.z);
    return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa);
  });
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToPolyline(p, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)));
  }
  return best;
}

function insideRotatedRect(p, b, margin) {
  const rad = (b.angleDeg * Math.PI) / 180;
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  // Along the building (east, turned north by angleDeg) and across it.
  const along = dx * Math.cos(rad) - dz * Math.sin(rad);
  const across = dx * Math.sin(rad) + dz * Math.cos(rad);
  return Math.abs(along) <= b.length / 2 + margin && Math.abs(across) <= b.width / 2 + margin;
}

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function boundsOf(poly) {
  const xs = poly.map((p) => p.x);
  const zs = poly.map((p) => p.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** The concrete yard outline in the scene frame. */
export function siteYard(ref, site = SURROUNDINGS) {
  return (site.yard || []).map((p) => siteToScene(ref, p));
}

/**
 * Converts the surroundings into the scene frame and scatters trees and
 * houses, keeping both off the paved area, the roads, the buildings and the
 * given clear spots (e.g. the Admin Office).
 *
 * @param {{ ref: object|null, paving: {x:number,z:number}[], clear?: {x:number,z:number,r:number}[],
 *           site?: typeof SURROUNDINGS }} input
 */
export function placeSurroundings({ ref, paving = [], clear = [], site = SURROUNDINGS }) {
  const conv = (pt) => siteToScene(ref, pt);
  const roads = site.roads.map((r) => ({ width: r.width, points: r.points.map(conv) }));
  const buildings = site.buildings.map((b) => {
    const c = conv([b.x, b.z]);
    return { ...b, x: c.x, z: c.z };
  });
  const walls = (site.walls || []).map((w) => ({
    ...w,
    points: w.points.map(conv),
    labels: (w.labels || []).map((l) => ({ label: l.label, ...conv([l.x, l.z]) })),
  }));

  const blocked = (p, margin) =>
    (paving.length >= 3 && pointInPolygon(p, paving)) ||
    roads.some((r) => distanceToPolyline(p, r.points) < r.width / 2 + margin) ||
    walls.some((w) => distanceToPolyline(p, w.points) < w.width / 2 + margin) ||
    buildings.some((b) => insideRotatedRect(p, b, margin)) ||
    clear.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.r);

  const rand = seeded(20261029);
  // Houses seen in the photo first, then scattered ones beyond it.
  const houses = (site.houses || []).map((h) => ({
    ...conv([h.x, h.z]),
    w: h.w,
    d: h.d,
    h: 3 + rand(),
    angle: (h.angleDeg * Math.PI) / 180,
    roof: h.roof,
  }));
  for (const area of site.houseAreas || []) {
    const poly = area.points.map(conv);
    const bb = boundsOf(poly);
    for (let x = bb.minX; x <= bb.maxX; x += 11) {
      for (let z = bb.minZ; z <= bb.maxZ; z += 10) {
        if (rand() < 0.3) continue;
        const p = { x: x + (rand() - 0.5) * 3, z: z + (rand() - 0.5) * 3 };
        if (!pointInPolygon(p, poly) || blocked(p, 6)) continue;
        if (houses.some((h) => Math.hypot(h.x - p.x, h.z - p.z) < 10)) continue;
        houses.push({
          ...p,
          w: 6 + rand() * 4,
          d: 5 + rand() * 3,
          h: 2.8 + rand() * 1.4,
          angle: (rand() - 0.5) * 0.4,
          roof: ROOF_COLORS[Math.floor(rand() * ROOF_COLORS.length)],
        });
      }
    }
  }

  const pavingEdge = paving.length >= 3 ? [...paving, paving[0]] : [];
  const trees = [];
  for (const forest of site.forests) {
    const poly = forest.points.map(conv);
    const bb = boundsOf(poly);
    const step = forest.spacing;
    for (let x = bb.minX; x <= bb.maxX; x += step) {
      for (let z = bb.minZ; z <= bb.maxZ; z += step) {
        const p = { x: x + (rand() - 0.5) * step * 0.9, z: z + (rand() - 0.5) * step * 0.9 };
        if (!pointInPolygon(p, poly) || blocked(p, 2.5)) continue;
        if (houses.some((h) => Math.hypot(h.x - p.x, h.z - p.z) < Math.max(h.w, h.d) / 2 + 3)) continue;
        if (trees.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < step * 0.6)) continue;
        const r = 2.2 + rand() * 2.2;
        // The whole canopy stays off the paved yard, so no tree hides a block.
        if (pavingEdge.length > 3 && distanceToPolyline(p, pavingEdge) < r + 1) continue;
        trees.push({ ...p, r, hue: (rand() - 0.5) * 0.06, light: rand() * 0.12 });
      }
    }
  }

  return { roads, buildings, walls, houses, trees };
}
