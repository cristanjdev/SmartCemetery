/**
 * Building Grid & Responsive Plot Subdivision Utility
 *
 * Provides pure mathematical functions to project, rotate, subdivide,
 * and snap rectangular building blocks (e.g. apartment crypt rows)
 * into individual plot cells with precise GPS coordinates.
 */

import {
  DEFAULT_BUILDING_TIERS,
  DEFAULT_BUILDING_WIDTH_M,
  DEFAULT_GRID_ANGLE_DEG,
  DEFAULT_MAP_CENTER,
} from "./config";
import {
  DEFAULT_BUILDING_PREFIX,
  PLOT_SIDES,
  belongsToBuilding,
  buildingPlotNumber,
  buildingSideCount,
  columnNumber,
  getBuildingKey,
  plotSide,
  sectionFromPlotNumber,
} from "./cemetery-layout";

export const M_TO_LAT = 1 / 110574;

export function mToLng(lat = DEFAULT_MAP_CENTER.lat) {
  return 1 / (111320 * Math.cos((lat * Math.PI) / 180));
}

/**
 * Converts a local Cartesian offset (dx: length along angleDeg in meters,
 * dy: depth perpendicular in meters) into GPS latitude and longitude.
 */
export function localOffsetToLatLng(dx, dy, centerLat, centerLng, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const latScale = M_TO_LAT;
  const lngScale = mToLng(centerLat);

  return {
    lat: Number((centerLat + (dx * sin + dy * cos) * latScale).toFixed(8)),
    lng: Number((centerLng + (dx * cos - dy * sin) * lngScale).toFixed(8)),
  };
}

/**
 * Converts a GPS latitude and longitude into local Cartesian offset
 * (dx: length along angleDeg in meters, dy: depth perpendicular in meters).
 */
export function latLngToLocalOffset(lat, lng, centerLat, centerLng, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const latScale = 110574;
  const lngScale = 111320 * Math.cos((centerLat * Math.PI) / 180);

  const dLat = (lat - centerLat) * latScale;
  const dLng = (lng - centerLng) * lngScale;

  const dx = dLat * sin + dLng * cos;
  const dy = dLat * cos - dLng * sin;

  return {
    dx: Number(dx.toFixed(2)),
    dy: Number(dy.toFixed(2)),
  };
}

/**
 * Calculates the 4 outer corners of a building block rectangle.
 * Returns array of { lat, lng } ordered: [Top-Left, Top-Right, Bottom-Right, Bottom-Left].
 */
export function getBuildingCorners({
  centerLat,
  centerLng,
  lengthMeters,
  widthMeters,
  angleDeg,
}) {
  const hl = lengthMeters / 2;
  const hw = widthMeters / 2;

  const offsets = [
    { dx: -hl, dy: hw },
    { dx: hl, dy: hw },
    { dx: hl, dy: -hw },
    { dx: -hl, dy: -hw },
  ];

  return offsets.map(({ dx, dy }) =>
    localOffsetToLatLng(dx, dy, centerLat, centerLng, angleDeg)
  );
}

/**
 * Subdivides a rectangular building into a responsive grid of rows and columns.
 * Assigns database plots to cells, computing the precise 4 corners and center GPS
 * for each plot cell.
 */
export function getSubdividedBuildingCells({
  centerLat,
  centerLng,
  lengthMeters,
  widthMeters,
  angleDeg,
  numCols = 1,
  numRows = 1,
  invertCols = false,
  targetPlots = [],
  targetRow = null,
}) {
  const cols = Math.max(1, parseInt(numCols, 10) || 1);
  const rows = Math.max(1, parseInt(numRows, 10) || 1);

  const firstPlot = targetPlots.find((p) => p && p.plotNumber);
  let rowPrefix = targetRow;
  if (!rowPrefix || rowPrefix === "custom") {
    rowPrefix =
      getBuildingKey(firstPlot) ||
      sectionFromPlotNumber(firstPlot?.plotNumber) ||
      DEFAULT_BUILDING_PREFIX;
  }
  const locationDetailId = firstPlot?.locationDetailId || firstPlot?.locationDetail?.id || null;

  const colWidth = lengthMeters / cols;
  const rowHeight = widthMeters / rows;

  // Existing plot numbers in this row, so a generated number can never collide
  // with one that is already mapped to a cell (e.g. a row with a gap such as
  // C01, C03 would otherwise regenerate C03 and silently drop a cell).
  const usedNumbers = new Set(
    (targetPlots || []).map((p) => p?.plotNumber).filter(Boolean)
  );

  const cells = [];
  let plotIndex = 0;

  // A back-to-back block: row 0 is the front face (A), row 1 the back face (B).
  // Plots are matched to columns by their column number, so a missing face
  // plot leaves its own cell empty instead of shifting its neighbours.
  const sided = rows === 2 && targetPlots.some((p) => plotSide(p));
  const columns = sided ? [...new Set(targetPlots.map(columnNumber))].sort((a, b) => a - b) : [];
  while (sided && columns.length < cols) columns.push((columns[columns.length - 1] || 0) + 1);
  const facePlot = (r, c) =>
    targetPlots.find((p) => plotSide(p) === PLOT_SIDES[r] && columnNumber(p) === columns[c]) || null;

  for (let r = 0; r < rows; r++) {
    const yMin = -widthMeters / 2 + r * rowHeight;
    const yMax = yMin + rowHeight;
    const yCenter = (yMin + yMax) / 2;

    for (let c = 0; c < cols; c++) {
      // Invert column order if needed (e.g. West-to-East vs East-to-West)
      const colIdx = invertCols ? cols - 1 - c : c;
      const xMin = -lengthMeters / 2 + colIdx * colWidth;
      const xMax = xMin + colWidth;
      const xCenter = (xMin + xMax) / 2;

      const center = localOffsetToLatLng(xCenter, yCenter, centerLat, centerLng, angleDeg);

      const corners = [
        localOffsetToLatLng(xMin, yMax, centerLat, centerLng, angleDeg),
        localOffsetToLatLng(xMax, yMax, centerLat, centerLng, angleDeg),
        localOffsetToLatLng(xMax, yMin, centerLat, centerLng, angleDeg),
        localOffsetToLatLng(xMin, yMin, centerLat, centerLng, angleDeg),
      ];

      let mappedPlot = (sided ? facePlot(r, c) : targetPlots[plotIndex]) || null;
      plotIndex++;

      const colNumber = c + 1;
      let label = "";
      const sidedNumber =
        sided && rowPrefix && rowPrefix !== "custom" ? buildingPlotNumber(rowPrefix, columns[c], PLOT_SIDES[r]) : null;

      if (mappedPlot) {
        label = mappedPlot.plotNumber;
      } else if (sidedNumber && !usedNumbers.has(sidedNumber)) {
        // A missing face plot takes its column's number and face letter.
        usedNumbers.add(sidedNumber);
        mappedPlot = {
          isNew: true,
          plotNumber: sidedNumber,
          locationDetailId,
          totalTiers: DEFAULT_BUILDING_TIERS,
          _buildingKey: rowPrefix,
          status: "available",
          graves: [],
        };
        label = sidedNumber;
      } else {
        // Generate the smallest unused column number for this row so gaps in
        // the existing numbering are filled instead of duplicated.
        let n = 1;
        let generatedPlotNumber;
        do {
          generatedPlotNumber =
            rowPrefix && rowPrefix !== "custom"
              ? buildingPlotNumber(rowPrefix, n)
              : `Plot ${n}`;
          n++;
        } while (usedNumbers.has(generatedPlotNumber));
        usedNumbers.add(generatedPlotNumber);

        mappedPlot = {
          isNew: true,
          plotNumber: generatedPlotNumber,
          locationDetailId,
          // Carried to the server so a new building plot is saved as one.
          totalTiers: DEFAULT_BUILDING_TIERS,
          _buildingKey: rowPrefix && rowPrefix !== "custom" ? rowPrefix : null,
          status: "available",
          graves: [],
        };
        label = generatedPlotNumber;
      }

      cells.push({
        index: cells.length,
        colIndex: c,
        rowIndex: r,
        center,
        corners,
        plot: mappedPlot,
        label,
        status: mappedPlot?.status || "available",
      });
    }
  }

  return cells;
}

/**
 * Snaps a building footprint directly to the existing GPS coordinates of a row.
 * Automatically computes centerLat, centerLng, and lengthMeters.
 */
export function snapBuildingToPlots(targetPlots, defaultAngle = DEFAULT_GRID_ANGLE_DEG) {
  const valid = (targetPlots || []).filter(
    (p) => p && p.gpsLat != null && p.gpsLng != null && !isNaN(Number(p.gpsLat)) && !isNaN(Number(p.gpsLng))
  );
  if (valid.length === 0) return null;

  let sumLat = 0;
  let sumLng = 0;
  for (const p of valid) {
    sumLat += Number(p.gpsLat);
    sumLng += Number(p.gpsLng);
  }
  const centerLat = sumLat / valid.length;
  const centerLng = sumLng / valid.length;

  let detectedAngle = defaultAngle ?? DEFAULT_GRID_ANGLE_DEG;
  if (valid.length >= 2) {
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of valid) {
      const dy = (Number(p.gpsLat) - centerLat) * 110574;
      const dx = (Number(p.gpsLng) - centerLng) * 111320 * Math.cos((centerLat * Math.PI) / 180);
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    // Only detect orientation if points span at least 1.5 meters variance
    if (sxx + syy > 2.0) {
      const angleRad = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      let deg = (angleRad * 180) / Math.PI;
      if (deg < 0) deg += 180;
      const targetDeg = defaultAngle ?? DEFAULT_GRID_ANGLE_DEG;
      while (Math.abs(deg - targetDeg) > 90) {
        if (deg > targetDeg) deg -= 180;
        else deg += 180;
      }
      if (deg < 0) deg += 360;
      detectedAngle = Number(deg.toFixed(1));
    }
  }

  let minDx = Infinity;
  let maxDx = -Infinity;

  for (const p of valid) {
    const { dx } = latLngToLocalOffset(
      Number(p.gpsLat),
      Number(p.gpsLng),
      centerLat,
      centerLng,
      detectedAngle
    );
    if (dx < minDx) minDx = dx;
    if (dx > maxDx) maxDx = dx;
  }

  const spanDx = maxDx - minDx;
  const lengthMeters = Math.max(5.0, Number((spanDx + 2.65).toFixed(1)));
  // A back-to-back block is two faces wide, with one plot per face per column.
  const sides = buildingSideCount(valid);
  const widthMeters = DEFAULT_BUILDING_WIDTH_M * sides;
  const numCols =
    sides === 2
      ? new Set(valid.map((p) => String(p.plotNumber || "").replace(/-[AB]\s*$/i, ""))).size
      : valid.length;

  return {
    centerLat: Number(centerLat.toFixed(8)),
    centerLng: Number(centerLng.toFixed(8)),
    lengthMeters,
    widthMeters,
    angleDeg: detectedAngle,
    numCols,
    numRows: sides,
  };
}

/**
 * Applies the calculated center GPS coordinates from the subdivided cells
 * to the plots in the target row. Also incorporates newly generated plots when
 * column count exceeds existing records, and marks excess plots as deleted/unpinned
 * when column count is reduced.
 */
export function applyBuildingCellsToPlots(cells, allPlots, targetRow = null) {
  const cellPlotMap = new Map();
  const cellPlotIds = new Set();
  const newPlotsToAdd = [];

  for (const cell of cells) {
    if (cell.plot?.id) {
      cellPlotMap.set(cell.plot.id, cell.center);
      cellPlotIds.add(cell.plot.id);
    } else if (cell.plot?.isNew) {
      const existingInAll = allPlots.find((p) => p.plotNumber === cell.plot.plotNumber);
      if (existingInAll) {
        if (existingInAll.id) {
          cellPlotMap.set(existingInAll.id, cell.center);
          cellPlotIds.add(existingInAll.id);
        }
      } else {
        newPlotsToAdd.push({
          ...cell.plot,
          gpsLat: cell.center.lat,
          gpsLng: cell.center.lng,
          _modified: true,
          _isNew: true,
          _deleted: false,
        });
      }
    }
  }

  const belongsToRow = (p) => belongsToBuilding(p, targetRow);

  const updatedExisting = allPlots.map((p) => {
    const newCoords = cellPlotMap.get(p.id);
    if (newCoords) {
      return {
        ...p,
        gpsLat: newCoords.lat,
        gpsLng: newCoords.lng,
        _modified: true,
        _deleted: false,
      };
    }

    // If plot belongs to the row being edited, but was excluded from cells (column/size reduction)
    if (belongsToRow(p) && !cellPlotIds.has(p.id)) {
      if (!p.id) {
        // Discard unsaved transient plots
        return {
          ...p,
          _modified: false,
          _deleted: true,
        };
      }
      const hasGrave = Array.isArray(p.graves) && p.graves.length > 0;
      if (hasGrave) {
        // Do not delete plots with active graves; unpin from grid instead
        return {
          ...p,
          gpsLat: null,
          gpsLng: null,
          _modified: true,
          _deleted: false,
        };
      } else {
        // Empty excess plot: mark for deletion
        return {
          ...p,
          _modified: true,
          _deleted: true,
        };
      }
    }

    return p;
  });

  return [...updatedExisting, ...newPlotsToAdd];
}
