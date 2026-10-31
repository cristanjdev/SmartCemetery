/**
 * Shared by the scripts that turn directory blocks (traced from the drone
 * photo in src/lib/site-surroundings.js) into rows of plots.
 */
const path = require("path");
const { createJiti } = require("jiti");

const jiti = createJiti(__filename, { alias: { "@": path.join(__dirname, "..", "..", "src") } });

/** The app's own site data and layout code (ES modules), loaded from a CommonJS script. */
async function loadSite() {
  const site = await jiti.import("../../src/lib/site-surroundings.js");
  const layout = await jiti.import("../../src/lib/scene-layout.js");
  return { ...site, buildSceneLayout: layout.buildSceneLayout };
}

/** Typical column pitch of the mapped rows (2.6–3.1 m). */
const COLUMN_M = 2.8;
/** Half the 2.8 m face width: each face's plots sit this far off the centre line. */
const FACE_OFFSET_M = 1.4;
const LAT_M = 110574;
const lngM = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

/**
 * Column centres of a directory block, both faces, as { col, side, lat, lng }.
 * Columns run from the far (`sw`) end, C01 first, like the mapped rows; front
 * plots (A) on the south-east face, back plots (B) on the other.
 *
 * @param {{ ne: [number, number], sw: [number, number] }} block site metres (x east, z south)
 * @param {{ lat: number, lng: number }} origin SITE_ORIGIN
 * @param {number} minCols at least this many columns
 */
function blockPositions({ ne, sw }, origin, minCols = 0) {
  const toLatLng = ([x, z]) => ({
    lat: Number((origin.lat - z / LAT_M).toFixed(8)),
    lng: Number((origin.lng + x / lngM(origin.lat)).toFixed(8)),
  });
  const dx = ne[0] - sw[0];
  const dz = ne[1] - sw[1];
  const length = Math.hypot(dx, dz);
  const cols = Math.max(minCols, Math.round(length / COLUMN_M));
  const ux = dx / length;
  const uz = dz / length;
  // Front face: to the right of the far→near direction (south-east).
  const fx = -uz;
  const fz = ux;
  const positions = [];
  for (let col = 1; col <= cols; col += 1) {
    const t = (length * (col - 0.5)) / cols;
    const cx = sw[0] + ux * t;
    const cz = sw[1] + uz * t;
    for (const [side, s] of [["A", 1], ["B", -1]]) {
      positions.push({ col, side, ...toLatLng([cx + fx * FACE_OFFSET_M * s, cz + fz * FACE_OFFSET_M * s]) });
    }
  }
  return { cols, positions };
}

const plotNo = (row, col, side) => `${row}-C${String(col).padStart(2, "0")}-${side}`;

module.exports = { loadSite, blockPositions, plotNo };
