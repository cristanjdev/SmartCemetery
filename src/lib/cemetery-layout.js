/**
 * Building / row identity, derived from data (pure — no React, no I/O).
 *
 * A "building" is a multi-tier structure (an apartment crypt row). Plots in it
 * are recognised by their own data, never by a naming convention or database
 * id:
 *
 *  - `Plot.totalTiers > 1` marks a plot as part of a building;
 *  - its building is its section, `plot.locationDetail.subsection`
 *    (new, not-yet-saved plots carry `_buildingKey` instead);
 *  - column order is the column number of the plot number;
 *  - a back-to-back block has two faces: its plots end in a side letter,
 *    "-A" for the front and "-B" for the back ("ROW-E02-C09-A"), and each
 *    face holds its own stack of tiers.
 *
 * Every layout tool (map, adjuster, grid generator, batch save) uses these
 * helpers so they cannot disagree about what belongs to a building.
 */

/** Absolute upper bound on tiers in one plot. The real limit is `Plot.totalTiers`. */
export const MAX_TIERS = 20;

/** Name prefix for a newly generated row when nothing else identifies one. */
export const DEFAULT_BUILDING_PREFIX = "ROW";

/** True when the plot is part of a multi-tier building. */
export function isBuildingPlot(plot) {
  return Boolean(plot) && Number(plot.totalTiers) > 1;
}

/** The building (row) a plot belongs to, or null for ordinary lots. */
export function getBuildingKey(plot) {
  if (!isBuildingPlot(plot)) return null;
  return plot._buildingKey || plot.locationDetail?.subsection || null;
}

/** True when `plot` belongs to building `key`. */
export function belongsToBuilding(plot, key) {
  return Boolean(key) && key !== "custom" && getBuildingKey(plot) === key;
}

/** The two faces of a back-to-back block, front first. */
export const PLOT_SIDES = ["A", "B"];

/** Face of a back-to-back block plot ("A" front, "B" back), or null for a one-sided plot. */
export function plotSide(plotOrNumber) {
  const number = typeof plotOrNumber === "string" ? plotOrNumber : plotOrNumber?.plotNumber;
  const m = /\d-([AB])\s*$/i.exec(number || "");
  return m ? m[1].toUpperCase() : null;
}

/** 2 when any of the plots belongs to a back-to-back block face, else 1. */
export function buildingSideCount(plots) {
  return (plots || []).some((p) => plotSide(p)) ? 2 : 1;
}

/** Column number of a building plot ("ROW-E02-C09-B" → 9), or 0 when it has none. */
export function columnNumber(plot) {
  const m = /(\d+)(?:-[AB])?\s*$/i.exec(plot?.plotNumber || "");
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Left-to-right column order: by column number, then front before back, then
 * by plot number. A plot with no column number sorts first.
 */
export function compareByColumn(a, b) {
  const diff = columnNumber(a) - columnNumber(b);
  if (diff !== 0) return diff;
  const sides = String(plotSide(a) || "").localeCompare(String(plotSide(b) || ""));
  if (sides !== 0) return sides;
  return String(a?.plotNumber || "").localeCompare(String(b?.plotNumber || ""), undefined, {
    numeric: true,
  });
}

/** Distinct building keys among `plots` (ignoring deleted ones), naturally sorted. */
export function listBuildingKeys(plots) {
  const keys = new Set();
  for (const p of plots || []) {
    if (p?._deleted) continue;
    const key = getBuildingKey(p);
    if (key) keys.add(key);
  }
  return [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Live (not deleted) plots of a building, in column order. */
export function plotsOfBuilding(plots, key) {
  return (plots || [])
    .filter((p) => !p?._deleted && belongsToBuilding(p, key))
    .sort(compareByColumn);
}

/**
 * What the letters at the start of a block's name mean, as on the printed
 * directory's legend ("FBN B2" is a fresh body niche block).
 */
export const BLOCK_TYPES = [
  { code: "FBN", name: "Fresh Body Niche" },
  { code: "SBN", name: "Special Body Niche" },
  { code: "BBN", name: "Baby Niche" },
  { code: "CB", name: "Columbarium" },
  { code: "UN", name: "Urn Niche" },
];

/** "Fresh Body Niche" for "FBN-B2" / "FBN B2"; null when the name has no type code. */
export function blockTypeName(key) {
  const m = /^([a-z]{2,4})[-\s]/i.exec(String(key ?? ""));
  return BLOCK_TYPES.find((t) => t.code === m?.[1]?.toUpperCase())?.name ?? null;
}

/** "FBN B2 · Fresh Body Niche" (the block's label, with its type when it has one). */
export function blockFullLabel(key) {
  const type = blockTypeName(key);
  return type ? `${buildingLabel(key)} · ${type}` : buildingLabel(key);
}

/**
 * Human label for a building key: "ROW-E01" → "Row E01", a directory block
 * "FBN-B21" → "FBN B21" (as the printed directory names it); others as-is.
 */
export function buildingLabel(key) {
  return String(key ?? "")
    .replace(/^ROW-/i, "Row ")
    .replace(/^([A-Z]{2,4})-(B\d+)$/i, "$1 $2");
}

/**
 * Section name for a generated plot number: the number without its `-C<nn>`
 * column suffix (and side letter). Inverse of the naming the grid generator
 * uses, so the client and server agree when a new plot arrives without an
 * explicit section.
 */
export function sectionFromPlotNumber(plotNumber) {
  return String(plotNumber || "").replace(/-C\d+(?:-[AB])?$/i, "");
}

/**
 * Plot-number for column `n` of building `key` (what the grid generator
 * creates), with the face letter for a back-to-back block ("ROW-E02-C09-B").
 */
export function buildingPlotNumber(key, n, side = null) {
  return `${key}-C${String(n).padStart(2, "0")}${side ? `-${side}` : ""}`;
}

/**
 * Short label for a building cell: its column number without leading zeros,
 * plus the face letter on a back-to-back block ("ROW-E01-C05" → "5",
 * "ROW-E01-C05-B" → "5B", "WALAG-001" → "1"); plot numbers with no trailing
 * number are returned unchanged.
 */
export function columnShortLabel(plotNumber) {
  const m = /(\d+)(?:-([AB]))?\s*$/i.exec(plotNumber || "");
  return m ? `${parseInt(m[1], 10)}${m[2] ? m[2].toUpperCase() : ""}` : String(plotNumber ?? "");
}
