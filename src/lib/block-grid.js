/**
 * Tidies the 3D map's blocks into the regular grid of the real cemetery
 * (pure — no React, no three.js).
 *
 * On site every crypt block runs parallel, sits on evenly spaced row lines
 * and ends on straight cross-aisles. Rows built from plot GPS are a little
 * off from that (angles vary by a few degrees, ends are staggered by a metre
 * or two), which reads as untidy in 3D. This straightens them for display
 * only: one common angle, row lines snapped to an even spacing, and block
 * ends that nearly line up snapped onto one line. The plot data and the 2D
 * map are untouched.
 *
 * Blocks are in the scene frame (x east, z south) with `rotationY` the angle
 * of the row's far-to-near direction, as built by scene-layout.js.
 */

/** Ends closer than this (metres, along the rows) are put on one line. */
export const END_SNAP_M = 2.2;
/**
 * A block traced from the photo joins a surveyed row line, or a surveyed
 * end line, this close to it (metres): the tracing is accurate to ~2 m.
 */
export const TRACED_SNAP_M = 4;
/** Traced blocks whose centre lines are this close (metres) share a row line. */
export const TRACED_LINE_M = 3;

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Groups sorted numbers whose neighbours are within `tol` and replaces each by its group's mean. */
export function snapClusters(values, tol = END_SNAP_M) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  let group = [];
  const flush = () => {
    const mean = group.reduce((s, [v]) => s + v, 0) / group.length;
    for (const [, i] of group) out[i] = mean;
    group = [];
  };
  for (const item of order) {
    if (group.length && item[0] - group[group.length - 1][0] > tol) flush();
    group.push(item);
  }
  if (group.length) flush();
  return out;
}

/** Even spacing and offset of the row lines, fitted to the mapped rows' across positions. */
export function fitRowLines(across, fallbackSpacing = 10.3) {
  const sorted = [...new Set(across.map((v) => Math.round(v * 10) / 10))].sort((a, b) => a - b);
  const steps = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1];
    if (d > 5) steps.push(d);
  }
  const spacing = steps.length ? median(steps) : fallbackSpacing;
  // Circular mean of each value's position within one spacing.
  let sx = 0;
  let sy = 0;
  for (const v of across) {
    const t = (2 * Math.PI * v) / spacing;
    sx += Math.cos(t);
    sy += Math.sin(t);
  }
  const offset = across.length ? (Math.atan2(sy, sx) / (2 * Math.PI)) * spacing : 0;
  return { spacing, offset };
}

/**
 * @param {Array<object>} mapped blocks with `cells` (plots), from scene-layout
 * @param {Array<object>} drawn directory blocks without plots, from placeUnmappedBlocks
 * @param {{ isReference?: (block: object) => boolean }} [options] which mapped blocks
 *   the grid (angle, row lines) is fitted to — the GPS-surveyed rows; the
 *   others are snapped onto it. Default: all of them.
 * @returns {{ mapped: Array<object>, drawn: Array<object> }} copies with tidied geometry
 */
export function regularizeBlocks(mapped = [], drawn = [], { isReference } = {}) {
  if (mapped.length === 0) return { mapped, drawn };
  const chosen = isReference ? mapped.filter(isReference) : mapped;
  const reference = chosen.length ? chosen : mapped;
  const theta = median(reference.map((b) => b.rotationY));
  const along = { x: Math.cos(theta), z: -Math.sin(theta) };
  const across = { x: Math.sin(theta), z: Math.cos(theta) };
  const proj = (p) => ({ u: p.x * along.x + p.z * along.z, v: p.x * across.x + p.z * across.z });
  const toScene = (u, v) => ({ x: u * along.x + v * across.x, z: u * along.z + v * across.z });

  const all = [...mapped, ...drawn].map((b) => {
    const c = proj(b.center);
    return { block: b, u0: c.u - b.length / 2, u1: c.u + b.length / 2, v: c.v };
  });

  const isRef = all.map((item) => reference.includes(item.block));
  const refIdx = all.map((_, i) => i).filter((i) => isRef[i]);
  const otherIdx = all.map((_, i) => i).filter((i) => !isRef[i]);

  // Surveyed rows: one even grid of row lines; ends that nearly line up, lined up.
  const { spacing, offset } = fitRowLines(refIdx.map((i) => all[i].v));
  const snapV = (v) => offset + Math.round((v - offset) / spacing) * spacing;
  const v = new Array(all.length);
  const u0 = new Array(all.length);
  const u1 = new Array(all.length);
  const refU0 = snapClusters(refIdx.map((i) => all[i].u0));
  const refU1 = snapClusters(refIdx.map((i) => all[i].u1));
  refIdx.forEach((i, k) => {
    v[i] = snapV(all[i].v);
    u0[i] = refU0[k];
    u1[i] = refU1[k];
  });

  // Traced blocks: onto a surveyed line or end close by; otherwise lined up
  // with the traced blocks beside them, keeping the photo's own spacing
  // (rounding them onto the even grid split blocks that share a line).
  const nearest = (value, lines) => {
    let best = null;
    for (const line of lines) if (Math.abs(line - value) <= TRACED_SNAP_M && (best === null || Math.abs(line - value) < Math.abs(best - value))) best = line;
    return best;
  };
  const refLines = [...new Set(refIdx.map((i) => v[i]))];
  const refStarts = [...new Set(refIdx.map((i) => u0[i]))];
  const refEnds = [...new Set(refIdx.map((i) => u1[i]))];
  const freeV = [];
  for (const i of otherIdx) {
    const line = nearest(all[i].v, refLines.filter((l) => Math.abs(l - all[i].v) <= TRACED_LINE_M));
    if (line !== null) v[i] = line;
    else freeV.push(i);
  }
  // Blocks that share a line in the photo stay together; each such line then
  // takes the next row line of the even grid, so every aisle is the same width.
  const clusteredV = snapClusters(freeV.map((i) => all[i].v), TRACED_LINE_M);
  const index = (value) => Math.round((value - offset) / spacing);
  const lineIndex = new Map();
  let previous = -Infinity;
  for (const value of [...new Set(clusteredV)].sort((a, b) => a - b)) {
    const k = Math.max(index(value), previous + 1);
    lineIndex.set(value, k);
    previous = k;
  }
  freeV.forEach((i, k) => {
    v[i] = offset + lineIndex.get(clusteredV[k]) * spacing;
  });
  // Ends: traced blocks whose ends line up in the photo are grouped, and a
  // group moves as one onto a surveyed end line close by. A traced block
  // keeps its traced length (so its columns stay a real width) and is lined
  // up by the end that matters: one on a surveyed end line, else the end it
  // shares with more blocks. Only when both ends reach surveyed lines is it
  // stretched or shortened between them.
  const groupEnds = (key, refLines) => {
    const grouped = snapClusters(otherIdx.map((i) => all[i][key]));
    const size = new Map();
    for (const value of grouped) size.set(value, (size.get(value) || 0) + 1);
    return otherIdx.map((i, k) => {
      const line = nearest(grouped[k], refLines);
      const at = line === null ? grouped[k] : line;
      return { at, onRef: line !== null, size: size.get(grouped[k]), move: Math.abs(at - all[i][key]) };
    });
  };
  const starts = groupEnds("u0", refStarts);
  const ends = groupEnds("u1", refEnds);
  otherIdx.forEach((i, k) => {
    const s0 = starts[k];
    const s1 = ends[k];
    const length = all[i].u1 - all[i].u0;
    const byStart = s0.onRef !== s1.onRef ? s0.onRef : s0.size !== s1.size ? s0.size > s1.size : s0.move <= s1.move;
    if (s0.onRef && s1.onRef) {
      u0[i] = s0.at;
      u1[i] = s1.at;
    } else if (byStart) {
      u0[i] = s0.at;
      u1[i] = s0.at + length;
    } else {
      u1[i] = s1.at;
      u0[i] = s1.at - length;
    }
  });

  const tidy = all.map((item, i) => {
    const b = item.block;
    const start = Math.min(u0[i], u1[i] - 1);
    const length = u1[i] - start;
    const center = toScene((start + u1[i]) / 2, v[i]);
    const out = { ...b, center, length, rotationY: theta };
    if (Array.isArray(b.cells) && b.cells.length) {
      // Plots keep their order along the row and are spaced evenly over the
      // tidied block; on a back-to-back block each face (front/back half) is
      // spaced on its own and keeps its side of the centre line.
      const groups = new Map();
      for (const cell of b.cells) {
        const key = cell.face ?? 0;
        if (!groups.has(key)) groups.set(key, []);
        const p = proj(cell.center);
        groups.get(key).push({ cell, u: p.u, side: p.v - item.v });
      }
      const placed = new Map();
      for (const list of groups.values()) {
        list.sort((p, q) => p.u - q.u);
        const cellLength = length / list.length;
        const side = groups.size > 1 ? median(list.map((p) => p.side)) : 0;
        list.forEach(({ cell }, k) => {
          placed.set(cell, { center: toScene(start + cellLength * (k + 0.5), v[i] + side), length: cellLength });
        });
      }
      out.cells = b.cells.map((cell) => ({ ...cell, ...placed.get(cell) }));
    }
    return out;
  });

  return { mapped: tidy.slice(0, mapped.length), drawn: tidy.slice(mapped.length) };
}
