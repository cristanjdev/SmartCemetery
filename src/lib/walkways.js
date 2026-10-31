/**
 * Walking routes inside the cemetery (pure — no React, no I/O).
 *
 * Street routers (OSRM) know the roads around the cemetery but not its
 * aisles, so on their own a route stops on the road and the last stretch
 * would cut straight through the crypt buildings. Here every apartment row
 * becomes a solid rectangular block, and the shortest walk around those
 * blocks is found on a visibility graph: the path only bends at block
 * corners, so it follows the aisles the way a visitor actually walks.
 *
 * Geometry is done in a flat local frame (metres east `x` / north `y` of a
 * reference point), which is exact enough at cemetery scale.
 */

/** Half the roof width of an apartment row, measured from its line of plots. */
export const BLOCK_HALF_WIDTH_M = 2.2;
/**
 * On a back-to-back block each face's plots sit half a face (1.4 m) inside
 * its wall, so the roof reaches this far past the outermost line of plots.
 */
export const FACE_EDGE_M = 1.4;
/** How far a row's walls reach past its first and last mapped plot. */
export const BLOCK_END_MARGIN_M = 1.8;
/** Gap kept between the walking line and a wall. */
export const WALL_CLEARANCE_M = 0.7;
/** Walking speed used for the time estimate (metres per second). */
export const WALKING_SPEED_MPS = 1.2;
/** A start this close to the outermost row is already inside the cemetery. */
export const ON_SITE_MARGIN_M = 30;
/**
 * A plot this far off its row's centre line belongs to one face of a
 * back-to-back row (front "-A" plots sit 1.4 m to one side, back "-B" plots
 * 1.4 m to the other); its niches open onto that side's aisle only.
 */
export const FACE_SIDE_MIN_M = 0.5;
/**
 * The cemetery's outer wall may only be crossed this close to where the walk
 * starts (the entrance by the Admin Office, or the visitor's own spot).
 */
export const GATE_M = 10;

const LAT_M = 110574;
const EPS = 0.05;

function lngMetres(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function toLocal(ref, { lat, lng }) {
  return { x: (lng - ref.lng) * lngMetres(ref.lat), y: (lat - ref.lat) * LAT_M };
}

function toLatLng(ref, { x, y }) {
  return {
    lat: Number((ref.lat + y / LAT_M).toFixed(8)),
    lng: Number((ref.lng + x / lngMetres(ref.lat)).toFixed(8)),
  };
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const length = (a) => Math.hypot(a.x, a.y);

/**
 * One block per building row: a rectangle along the row's own direction
 * (fitted to its plots, since rows are not perfectly parallel), covering its
 * plots plus the roof and end walls. Rows with fewer than two mapped plots
 * have no direction and are left out.
 *
 * Buildings and blocks that have no plots in the system (`obstacles`) are
 * added as solid rectangles too, so a route goes round them instead of
 * through them; one that overlaps a mapped row is left out (the row wins).
 *
 * @param {Array<{ key: string, lat: number, lng: number }>} points building plots
 * @param {Array<{ key: string, center: {lat:number,lng:number}, angleDeg: number, length: number, width: number }>} obstacles
 *   rectangles; `angleDeg` is the long side's direction, counter-clockwise from east
 * @param {Array<{lat:number,lng:number}>} boundary the cemetery's outer wall (a polygon):
 *   a walk stays inside it, crossing only at the gate where it starts
 * @returns {{ ref: {lat:number,lng:number} | null, blocks: Array<object>, walls: Array<{x:number,y:number}>, reach: number }}
 *   `reach` is how far (metres) the outermost row corner lies from `ref`.
 */
export function buildWalkwayNetwork(points, obstacles = [], boundary = []) {
  const valid = (points || []).filter(
    (p) => p && p.key && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );
  if (valid.length === 0) return { ref: null, blocks: [], walls: [], reach: 0 };

  const ref = {
    lat: valid.reduce((sum, p) => sum + p.lat, 0) / valid.length,
    lng: valid.reduce((sum, p) => sum + p.lng, 0) / valid.length,
  };

  const rows = new Map();
  for (const p of valid) {
    if (!rows.has(p.key)) rows.set(p.key, []);
    rows.get(p.key).push(toLocal(ref, p));
  }

  const blocks = [];
  for (const [key, pts] of rows) {
    if (pts.length < 2) continue;
    const center = {
      x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
      y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
    };
    // Principal axis of the plots = the direction the row runs.
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      const d = sub(p, center);
      sxx += d.x * d.x;
      syy += d.y * d.y;
      sxy += d.x * d.y;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const v = { x: -u.y, y: u.x };

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of pts) {
      const d = sub(p, center);
      minU = Math.min(minU, dot(d, u));
      maxU = Math.max(maxU, dot(d, u));
      minV = Math.min(minV, dot(d, v));
      maxV = Math.max(maxV, dot(d, v));
    }
    const midU = (minU + maxU) / 2;
    const midV = (minV + maxV) / 2;
    blocks.push({
      key,
      center: {
        x: center.x + u.x * midU + v.x * midV,
        y: center.y + u.y * midU + v.y * midV,
      },
      u,
      v,
      halfLength: (maxU - minU) / 2 + BLOCK_END_MARGIN_M,
      // One line of plots: the roof's half width round it. Two faces: half a face past each.
      halfWidth: Math.max(BLOCK_HALF_WIDTH_M, (maxV - minV) / 2 + FACE_EDGE_M),
    });
  }
  // "On site" is measured from the rows only, before the buildings are added.
  const reach = Math.max(
    0,
    ...blocks.flatMap((block) => blockCorners(block, 0).map((corner) => length(corner)))
  );

  const rowCount = blocks.length;
  for (const o of obstacles || []) {
    if (!o?.center || !Number.isFinite(o.length) || !Number.isFinite(o.width)) continue;
    const angle = ((o.angleDeg || 0) * Math.PI) / 180;
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const block = {
      key: o.key,
      center: toLocal(ref, o.center),
      u,
      v: { x: -u.y, y: u.x },
      halfLength: o.length / 2,
      halfWidth: o.width / 2,
      obstacle: true,
    };
    const overlapsRow = blocks
      .slice(0, rowCount)
      .some((row) => blockCorners(block, 0).some((c) => insideBlock(row, c, 0)) || insideBlock(block, row.center, 0));
    if (!overlapsRow) blocks.push(block);
  }
  const walls = (boundary || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
    .map((p) => toLocal(ref, p));
  return { ref, blocks, walls: walls.length >= 3 ? walls : [], reach };
}

/** True when `point` is in (or right beside) the mapped rows. */
export function isOnSite(network, point) {
  if (!network?.ref || !network.blocks?.length) return false;
  return length(toLocal(network.ref, point)) <= network.reach + ON_SITE_MARGIN_M;
}

/** Corners of a block grown by `grow` metres on every side. */
function blockCorners(block, grow) {
  const a = block.halfLength + grow;
  const b = block.halfWidth + grow;
  return [
    [a, b],
    [-a, b],
    [-a, -b],
    [a, -b],
  ].map(([su, sv]) => ({
    x: block.center.x + block.u.x * su + block.v.x * sv,
    y: block.center.y + block.u.y * su + block.v.y * sv,
  }));
}

function insideBlock(block, p, grow) {
  const d = sub(p, block.center);
  return (
    Math.abs(dot(d, block.u)) < block.halfLength + grow &&
    Math.abs(dot(d, block.v)) < block.halfWidth + grow
  );
}

/** True when segment a→b passes through the (grown) block (separating axes). */
function segmentHitsBlock(block, a, b, grow) {
  const ha = block.halfLength + grow;
  const hb = block.halfWidth + grow;
  const da = sub(a, block.center);
  const db = sub(b, block.center);
  for (const [axis, half] of [
    [block.u, ha],
    [block.v, hb],
  ]) {
    const pa = dot(da, axis);
    const pb = dot(db, axis);
    if (Math.max(pa, pb) <= -half || Math.min(pa, pb) >= half) return false;
  }
  const dir = sub(b, a);
  const normal = { x: -dir.y, y: dir.x };
  const corners = blockCorners(block, grow).map((c) => dot(sub(c, a), normal));
  return !(corners.every((s) => s >= 0) || corners.every((s) => s <= 0));
}

/**
 * True when a→b crosses the outer wall anywhere but at the gate (within
 * GATE_M of `gate`, where the walk starts).
 */
function crossesWall(walls, a, b, gate) {
  const d = sub(b, a);
  for (let i = 0; i < walls.length; i += 1) {
    const p = walls[i];
    const q = walls[(i + 1) % walls.length];
    const e = sub(q, p);
    const den = cross(d, e);
    if (Math.abs(den) < 1e-9) continue;
    const ap = sub(p, a);
    const t = cross(ap, e) / den;
    const u = cross(ap, d) / den;
    if (t <= 1e-6 || t >= 1 - 1e-6 || u < 0 || u > 1) continue;
    const hit = { x: a.x + d.x * t, y: a.y + d.y * t };
    if (length(sub(hit, gate)) > GATE_M) return true;
  }
  return false;
}

/**
 * Where a visitor stands to reach `p`. A plot inside a row is reached from
 * the aisle beside it: with `ownFace`, only its own face's aisle on a
 * back-to-back row, otherwise either side; a point in the open is reached
 * directly.
 */
function standingPoints(blocks, p, { ownFace = false } = {}) {
  const containing = blocks.filter((block) => insideBlock(block, p, WALL_CLEARANCE_M));
  if (containing.length === 0) return [p];
  const free = (list) => list.filter((c) => !blocks.some((block) => insideBlock(block, c, WALL_CLEARANCE_M)));
  const beside = (sidesOf) => {
    const candidates = [];
    for (const block of containing) {
      const d = sub(p, block.center);
      const along = dot(d, block.u);
      const off = dot(d, block.v);
      const out = block.halfWidth + WALL_CLEARANCE_M + EPS;
      for (const side of sidesOf(off)) {
        candidates.push({
          x: block.center.x + block.u.x * along + block.v.x * out * side,
          y: block.center.y + block.u.y * along + block.v.y * out * side,
        });
      }
    }
    return candidates;
  };
  const bothSides = beside(() => [1, -1]);
  if (ownFace) {
    // A plot on one face of a back-to-back row is reached from that face's aisle.
    const faceSide = free(beside((off) => (Math.abs(off) >= FACE_SIDE_MIN_M ? [Math.sign(off)] : [1, -1])));
    if (faceSide.length) return faceSide;
  }
  const open = free(bothSides);
  return open.length ? open : bothSides;
}

/**
 * Shortest walk from `origin` to `destination` around the building rows.
 *
 * @returns {{ path: Array<{lat:number,lng:number}>, distance: number,
 *   duration: number, steps: Array<object> } | null} null when there are no
 *   rows to route around or no walkable path exists.
 */
export function findWalkingRoute(network, origin, destination) {
  if (!network?.ref || !network.blocks?.length) return null;
  // Inside the outer wall when there is one; if that leaves no way through
  // (e.g. a plot traced right against the wall), round the blocks only.
  if (network.walls?.length) {
    const walled = searchWalk(network, origin, destination, network.walls);
    if (walled) return walled;
  }
  return searchWalk(network, origin, destination, []);
}

function searchWalk(network, origin, destination, walls) {
  const { ref, blocks } = network;
  const plot = toLocal(ref, destination);
  const gate = toLocal(ref, origin);
  const starts = standingPoints(blocks, gate);
  const goals = standingPoints(blocks, plot, { ownFace: true });

  // Graph nodes: start(s), goal(s), and every reachable block corner set just
  // outside the walking clearance, so a path can hug a corner without
  // touching it.
  const nodes = [...starts, ...goals];
  const goalIds = new Set(goals.map((_, i) => starts.length + i));
  for (const block of blocks) {
    for (const corner of blockCorners(block, WALL_CLEARANCE_M + EPS)) {
      if (!blocks.some((other) => insideBlock(other, corner, WALL_CLEARANCE_M))) {
        nodes.push(corner);
      }
    }
  }

  const visible = (i, j) =>
    !blocks.some((block) => segmentHitsBlock(block, nodes[i], nodes[j], WALL_CLEARANCE_M)) &&
    !(walls.length && crossesWall(walls, nodes[i], nodes[j], gate));

  // Dijkstra from all starts at once (the graph is small: ~4 nodes per row).
  const dist = nodes.map((_, i) => (i < starts.length ? 0 : Infinity));
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  let reached = -1;
  for (;;) {
    let current = -1;
    for (let i = 0; i < nodes.length; i += 1) {
      if (!done[i] && dist[i] < Infinity && (current < 0 || dist[i] < dist[current])) current = i;
    }
    if (current < 0) break;
    if (goalIds.has(current)) {
      reached = current;
      break;
    }
    done[current] = true;
    for (let next = 0; next < nodes.length; next += 1) {
      if (done[next] || next === current) continue;
      const step = length(sub(nodes[next], nodes[current]));
      if (dist[current] + step < dist[next] && visible(current, next)) {
        dist[next] = dist[current] + step;
        prev[next] = current;
      }
    }
  }
  if (reached < 0) return null;

  const local = [];
  for (let i = reached; i >= 0; i = prev[i]) local.unshift(nodes[i]);
  const distance = dist[reached];

  return {
    path: local.map((p) => toLatLng(ref, p)),
    distance,
    duration: distance / WALKING_SPEED_MPS,
    steps: describeWalk(local, plot),
  };
}

const COMPASS = ["east", "northeast", "north", "northwest", "west", "southwest", "south", "southeast"];

function heading(d) {
  const deg = ((Math.atan2(d.y, d.x) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

function turnWords(before, after) {
  const deg = (Math.atan2(cross(before, after), dot(before, after)) * 180) / Math.PI;
  const side = deg > 0 ? "left" : "right";
  const size = Math.abs(deg);
  if (size < 25) return "Continue straight";
  if (size < 60) return `Bear ${side}`;
  if (size < 140) return `Turn ${side}`;
  return `Make a sharp ${side}`;
}

/**
 * Plain-language steps for a walk. Each step carries its own sentence in
 * `instruction` (shown as-is by formatRouteSteps) plus OSRM-style fields.
 */
function describeWalk(points, plot) {
  const legs = [];
  for (let i = 1; i < points.length; i += 1) {
    const d = sub(points[i], points[i - 1]);
    const len = length(d);
    if (len < 0.5) continue;
    const last = legs[legs.length - 1];
    // Merge nearly-straight bends into one leg.
    if (last && Math.abs(Math.atan2(cross(last.dir, d), dot(last.dir, d))) < (12 * Math.PI) / 180) {
      last.distance += len;
      last.dir = d;
      continue;
    }
    legs.push({ dir: d, start: d, distance: len });
  }

  const steps = legs.map((leg, i) => ({
    instruction:
      i === 0
        ? `Head ${heading(leg.start)}`
        : turnWords(legs[i - 1].dir, leg.start),
    distance: leg.distance,
    maneuver: { type: i === 0 ? "depart" : "turn", modifier: "" },
    name: "",
  }));

  const end = points[points.length - 1];
  const finalDir = legs.length ? legs[legs.length - 1].dir : null;
  const toPlot = sub(plot, end);
  let where = "";
  if (finalDir && length(toPlot) > 0.5) {
    where = cross(finalDir, toPlot) > 0 ? " — it is on your left" : " — it is on your right";
  }
  steps.push({
    instruction: `Arrive at the plot${where}`,
    distance: 0,
    maneuver: { type: "arrive", modifier: "" },
    name: "",
  });
  return steps;
}
