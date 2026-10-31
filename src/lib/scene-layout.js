/**
 * 3D cemetery scene layout (pure — no React, no three.js).
 *
 * Turns burial rows into blocks in a flat local frame for the 3D map:
 * `x` is metres east and `z` is metres south of a reference point (three.js
 * looks down -z, so north is "into" the screen). Rows come from the layout
 * preset, so a visitor who searched for one grave still sees the whole
 * cemetery; plots loaded from the database replace the preset's copy, and a
 * row the database fully covers takes its geometry from the database (the
 * Admin's latest alignment).
 */

import { getBuildingCorners, getSubdividedBuildingCells, snapBuildingToPlots } from "./building-grid";
import { buildingLabel, compareByColumn, getBuildingKey } from "./cemetery-layout";
import { DEFAULT_GRID_ANGLE_DEG } from "./config";

const LAT_M = 110574;

/** Blocks are drawn at least this wide, like the apartment crypts on site. */
export const MIN_BLOCK_WIDTH_M = 4.5;

function lngMetres(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

/** GPS -> local metres ({ x: east, z: south }) around `ref`. */
export function toLocal(ref, { lat, lng }) {
  return { x: (lng - ref.lng) * lngMetres(ref.lat), z: -(lat - ref.lat) * LAT_M };
}

/** Local metres -> GPS, the inverse of `toLocal`. */
export function toLatLng(ref, { x, z }) {
  return { lat: ref.lat - z / LAT_M, lng: ref.lng + x / lngMetres(ref.lat) };
}

function hasGps(p) {
  return p && p.gpsLat != null && p.gpsLng != null && Number.isFinite(Number(p.gpsLat)) && Number.isFinite(Number(p.gpsLng));
}

/** Convex hull (monotone chain) of { x, z } points, counter-clockwise. */
export function hull2d(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half(pts.slice().reverse())];
}

/** Pushes each hull corner `metres` further out from the hull's centre (the paved area). */
export function growFootprint(footprint, metres) {
  if (footprint.length < 3) return footprint;
  const cx = footprint.reduce((s, p) => s + p.x, 0) / footprint.length;
  const cz = footprint.reduce((s, p) => s + p.z, 0) / footprint.length;
  return footprint.map((p) => {
    const d = Math.hypot(p.x - cx, p.z - cz) || 1;
    return { x: p.x + ((p.x - cx) / d) * metres, z: p.z + ((p.z - cz) / d) * metres };
  });
}

/** Preset row plots in the shape the database returns them. */
function presetPlots(row) {
  return (row?.plots || []).map((p) => ({
    plotNumber: p.plotNumber,
    status: p.status || "available",
    gpsLat: p.lat,
    gpsLng: p.lng,
    _buildingKey: row.rowKey,
    _preset: true,
  }));
}

/**
 * @param {{ plots?: object[], preset?: { rows?: object, rowConfigs?: object, deletedRows?: string[] },
 *           gridAngle?: number }} input
 * @returns {{ ref: {lat:number,lng:number} | null, blocks: object[], footprint: {x:number,z:number}[],
 *             bounds: {minX:number,maxX:number,minZ:number,maxZ:number} | null }}
 */
export function buildSceneLayout({ plots = [], preset = {}, gridAngle = DEFAULT_GRID_ANGLE_DEG } = {}) {
  const deleted = new Set(preset.deletedRows || []);
  const dbRows = new Map();
  for (const p of plots) {
    if (!p || p._deleted || !hasGps(p)) continue;
    const key = getBuildingKey(p);
    if (!key || deleted.has(key)) continue;
    if (!dbRows.has(key)) dbRows.set(key, []);
    dbRows.get(key).push(p);
  }

  const keys = new Set([...Object.keys(preset.rowConfigs || {}), ...dbRows.keys()]);
  const rawBlocks = [];
  for (const key of keys) {
    if (deleted.has(key)) continue;
    const fromDb = (dbRows.get(key) || []).slice().sort(compareByColumn);
    const fromPreset = presetPlots(preset.rows?.[key]).sort(compareByColumn);
    const presetCfg = preset.rowConfigs?.[key];

    let cfg;
    let rowPlots;
    if (fromDb.length >= 2 && fromDb.length >= fromPreset.length) {
      const snapped = snapBuildingToPlots(fromDb, gridAngle);
      if (!snapped) continue;
      cfg = { ...snapped, invertCols: false };
      rowPlots = fromDb;
    } else if (presetCfg) {
      const byNumber = new Map(fromDb.map((p) => [p.plotNumber, p]));
      rowPlots = fromPreset.map((p) => byNumber.get(p.plotNumber) || p);
      cfg = { ...presetCfg, numRows: presetCfg.numRows || 1, numCols: presetCfg.numCols || rowPlots.length };
    } else {
      const snapped = snapBuildingToPlots(fromDb, gridAngle);
      if (!snapped) continue;
      cfg = { ...snapped, invertCols: false };
      rowPlots = fromDb;
    }
    rawBlocks.push({ key, cfg, rowPlots });
  }
  if (rawBlocks.length === 0) return { ref: null, blocks: [], footprint: [], bounds: null };

  const ref = {
    lat: rawBlocks.reduce((s, b) => s + b.cfg.centerLat, 0) / rawBlocks.length,
    lng: rawBlocks.reduce((s, b) => s + b.cfg.centerLng, 0) / rawBlocks.length,
  };

  const corners = [];
  const blocks = rawBlocks
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
    .map(({ key, cfg, rowPlots }) => {
      const blockCorners = getBuildingCorners(cfg).map((c) => toLocal(ref, c));
      corners.push(...blockCorners);
      const cellLength = cfg.lengthMeters / Math.max(1, cfg.numCols);
      const faces = Math.max(1, cfg.numRows || 1);
      const width = Math.max(cfg.widthMeters, MIN_BLOCK_WIDTH_M);
      const cells = getSubdividedBuildingCells({ ...cfg, targetPlots: rowPlots, targetRow: key }).map((cell) => ({
        plot: cell.plot && !cell.plot.isNew ? cell.plot : null,
        label: cell.label,
        status: cell.status,
        center: toLocal(ref, cell.center),
        length: cellLength,
        // On a back-to-back block each plot fills one face (half the width).
        width: width / faces,
        face: faces > 1 ? cell.rowIndex : null,
      }));
      return {
        key,
        label: buildingLabel(key),
        center: toLocal(ref, { lat: cfg.centerLat, lng: cfg.centerLng }),
        length: cfg.lengthMeters,
        width,
        faces,
        // Grid angles run counter-clockwise from east; three.js turns +x toward -z
        // for a positive Y rotation, which is the same direction on the map.
        rotationY: (cfg.angleDeg * Math.PI) / 180,
        corners: blockCorners,
        cells,
      };
    });

  const xs = corners.map((c) => c.x);
  const zs = corners.map((c) => c.z);
  return {
    ref,
    blocks,
    footprint: hull2d(corners),
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
  };
}
