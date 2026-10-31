/**
 * Pure map geometry and plot helpers (no React, no Google Maps), extracted from
 * CemeteryMap so they can be imported without loading the map component and
 * unit-tested directly.
 */

import { DEFAULT_GRID_ANGLE_DEG } from "./config";
import { isBuildingPlot } from "./cemetery-layout";
import { latLngToLocalOffset, localOffsetToLatLng } from "./building-grid";

// Plot Status Color Palette (matches reference plot-map design)
export function getPlotStatusColor(status) {
  switch (status?.toLowerCase()) {
    case "occupied":
      return "#E15B52"; // Salmon Red (Occupied)
    case "partial":
      // A partly filled column is occupied; its vacant tiers are drawn as green strips (splitCellAcross).
      return "#E15B52";
    case "available":
      return "#7CC47F"; // Soft Green (Available)
    case "reserved":
      return "#C9CDDC"; // Light Gray-Lavender (Reserved)
    case "maintenance":
    default:
      return "#6674D7"; // Periwinkle Blue (Maintenance)
  }
}

/**
 * Splits a plot cell [c0, c1, c2, c3] (c0 -> c1 runs along the row) into `n`
 * strips across its width, one per tier: strip 0 (tier 1) lies along the
 * c3 -> c2 edge. Lets the map colour each tier of a crypt column.
 */
export function splitCellAcross(corners, n) {
  const [c0, c1, c2, c3] = corners;
  const lerp = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  return Array.from({ length: n }, (_, k) => {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    return [lerp(c3, c0, t0), lerp(c2, c1, t0), lerp(c2, c1, t1), lerp(c3, c0, t1)];
  });
}

// Compute rotated rectangular footprint for a plot cell
export function getPlotCorners({
  lat,
  lng,
  widthMeters = 2.65,
  depthMeters = 1.6,
  angleDeg = DEFAULT_GRID_ANGLE_DEG,
}) {
  const mToLat = 1 / 110574;
  const mToLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const hw = widthMeters / 2;
  const hd = depthMeters / 2;

  const corners = [
    { dx: -hw, dy: -hd },
    { dx: hw, dy: -hd },
    { dx: hw, dy: hd },
    { dx: -hw, dy: hd },
  ];

  return corners.map(({ dx, dy }) => ({
    lat: lat + (dx * sin + dy * cos) * mToLat,
    lng: lng + (dx * cos - dy * sin) * mToLng,
  }));
}

/** A live (not deleted) plot that is part of a multi-tier building. */
export function isActiveBuildingPlot(plot) {
  return Boolean(plot) && !plot._deleted && isBuildingPlot(plot);
}

function hasGps(p) {
  return Number.isFinite(Number(p?.gpsLat)) && Number.isFinite(Number(p?.gpsLng)) && p?.gpsLat != null && p?.gpsLng != null;
}

/**
 * Centre (mean position) of the pinned building plots, or null when there are
 * none. Boundary offsets are expressed relative to this point.
 */
export function getBuildingsCenter(plots) {
  const pinned = (plots || []).filter((p) => isActiveBuildingPlot(p) && hasGps(p));
  if (pinned.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const p of pinned) {
    lat += Number(p.gpsLat);
    lng += Number(p.gpsLng);
  }
  return { lat: lat / pinned.length, lng: lng / pinned.length };
}

/**
 * Draw the boundary polygon from its offsets (metres East/North of the
 * centre, stored in the reference-angle frame) at the current grid angle.
 *
 * @returns {Array<{lat:number,lng:number}>} [] when there are fewer than 3 offsets
 */
export function getBoundaryCoords(centerLat, centerLng, angle, offsets) {
  if (!Array.isArray(offsets) || offsets.length < 3) return [];
  const rad = (((angle ?? DEFAULT_GRID_ANGLE_DEG) - DEFAULT_GRID_ANGLE_DEG) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const latScale = 110574;
  const lngScale = 111320 * Math.cos((centerLat * Math.PI) / 180);

  return offsets.map(({ dx, dy }) => {
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return {
      lat: Number((centerLat + ry / latScale).toFixed(8)),
      lng: Number((centerLng + rx / lngScale).toFixed(8)),
    };
  });
}

/**
 * Default boundary when none has been saved: the smallest rectangle, aligned
 * to the building grid, that encloses every pinned building plot plus
 * `paddingMeters`. Returns offsets ready for `getBoundaryCoords` (null when
 * there is nothing to enclose).
 */
// `extraPoints` ({ lat, lng }) widen the rectangle too, e.g. the corners of
// directory blocks that have no plots yet, so the default boundary covers
// the whole park.
export function deriveBoundaryOffsets(plots, angle = DEFAULT_GRID_ANGLE_DEG, paddingMeters = 8, extraPoints = []) {
  const center = getBuildingsCenter(plots);
  if (!center) return null;
  const frame = angle ?? DEFAULT_GRID_ANGLE_DEG;

  let minDx = Infinity;
  let maxDx = -Infinity;
  let minDy = Infinity;
  let maxDy = -Infinity;
  for (const p of plots) {
    if (!isActiveBuildingPlot(p) || !hasGps(p)) continue;
    const { dx, dy } = latLngToLocalOffset(Number(p.gpsLat), Number(p.gpsLng), center.lat, center.lng, frame);
    minDx = Math.min(minDx, dx);
    maxDx = Math.max(maxDx, dx);
    minDy = Math.min(minDy, dy);
    maxDy = Math.max(maxDy, dy);
  }
  for (const p of extraPoints || []) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) continue;
    const { dx, dy } = latLngToLocalOffset(p.lat, p.lng, center.lat, center.lng, frame);
    minDx = Math.min(minDx, dx);
    maxDx = Math.max(maxDx, dx);
    minDy = Math.min(minDy, dy);
    maxDy = Math.max(maxDy, dy);
  }

  const pad = paddingMeters;
  const corners = [
    { dx: minDx - pad, dy: maxDy + pad },
    { dx: maxDx + pad, dy: maxDy + pad },
    { dx: maxDx + pad, dy: minDy - pad },
    { dx: minDx - pad, dy: minDy - pad },
  ].map(({ dx, dy }) => localOffsetToLatLng(dx, dy, center.lat, center.lng, frame));

  return coordsToBoundaryOffsets(corners, center.lat, center.lng, frame);
}

export function coordsToBoundaryOffsets(coords, centerLat, centerLng, angle = DEFAULT_GRID_ANGLE_DEG) {
  const latScale = 110574;
  const lngScale = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const rad = (((angle ?? DEFAULT_GRID_ANGLE_DEG) - DEFAULT_GRID_ANGLE_DEG) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return coords.map(({ lat, lng }) => {
    const ry = (lat - centerLat) * latScale;
    const rx = (lng - centerLng) * lngScale;
    const dx = rx * cos + ry * sin;
    const dy = -rx * sin + ry * cos;
    return { dx: Number(dx.toFixed(2)), dy: Number(dy.toFixed(2)) };
  });
}
