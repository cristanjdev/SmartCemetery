/**
 * Export the current plot layout of one location as a layout preset
 * (src/lib/layout-preset.json).
 *
 *   node scripts/export-current-preset.js "Name of location"
 *   PRESET_LOCATION_NAME="Name of location" node scripts/export-current-preset.js
 *
 * The location is found by a case-insensitive name match (falling back to the
 * existing preset's `location.matchName`). Only the plot positions are
 * regenerated; the preset's identity (name, description, location), tier count,
 * retired rows and per-row building configs are preserved from the existing
 * file, as is the record of renamed rows (`renamedRows`). Rows that are new will
 * have no building config until one is added.
 */
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();
const presetPath = path.join(__dirname, "../src/lib/layout-preset.json");

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(presetPath, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const existing = readExisting();
  const wanted =
    process.argv[2] || process.env.PRESET_LOCATION_NAME || existing.location?.matchName || "";
  if (!wanted.trim()) {
    throw new Error(
      "Say which location to export: pass its name as an argument or set PRESET_LOCATION_NAME."
    );
  }

  const locations = await prisma.location.findMany({
    where: { name: { contains: wanted.trim() } },
    select: { id: true, name: true, description: true, gpsLat: true, gpsLng: true },
  });
  if (locations.length === 0) throw new Error(`No location matches "${wanted}".`);
  if (locations.length > 1) {
    throw new Error(
      `"${wanted}" matches several locations; be more specific:\n  ` +
        locations.map((l) => l.name).join("\n  ")
    );
  }
  const location = locations[0];

  const plots = await prisma.plot.findMany({
    where: { locationDetail: { locationId: location.id } },
    select: {
      plotNumber: true,
      gpsLat: true,
      gpsLng: true,
      status: true,
      totalTiers: true,
      locationDetail: { select: { subsection: true } },
    },
    orderBy: [{ locationDetail: { sortOrder: "asc" } }, { plotNumber: "asc" }],
  });

  const pinned = plots.filter((p) => p.gpsLat !== null && p.gpsLng !== null);
  console.log(`${location.name}: ${plots.length} plots, ${pinned.length} pinned, ${plots.length - pinned.length} unpinned.`);

  const rows = {};
  for (const p of pinned) {
    const rowKey = p.locationDetail?.subsection;
    if (!rowKey) continue;
    (rows[rowKey] ||= []).push({
      plotNumber: p.plotNumber,
      lat: Number(p.gpsLat),
      lng: Number(p.gpsLng),
      status: p.status,
    });
  }

  const presetRows = {};
  for (const [rowKey, list] of Object.entries(rows)) {
    const mean = (xs) => Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(8));
    presetRows[rowKey] = {
      rowKey,
      plotCount: list.length,
      centerLat: mean(list.map((p) => p.lat)),
      centerLng: mean(list.map((p) => p.lng)),
      plots: list,
    };
  }

  const tierCounts = pinned.map((p) => p.totalTiers).filter((n) => n > 1);
  const preset = {
    name: existing.name || `${location.name} layout`,
    description: existing.description || `Plot layout exported from ${location.name}.`,
    location: {
      name: location.name,
      matchName: existing.location?.matchName || wanted.trim(),
      description: location.description ?? existing.location?.description ?? null,
      gpsLat: location.gpsLat != null ? Number(location.gpsLat) : existing.location?.gpsLat ?? null,
      gpsLng: location.gpsLng != null ? Number(location.gpsLng) : existing.location?.gpsLng ?? null,
    },
    tiersPerPlot: existing.tiersPerPlot || (tierCounts.length ? Math.max(...tierCounts) : 4),
    deletedRows: existing.deletedRows || [],
    // Old row name → new one, so an older database is renamed when the preset is applied.
    ...(existing.renamedRows ? { renamedRows: existing.renamedRows } : {}),
    rowConfigs: Object.fromEntries(
      Object.entries(existing.rowConfigs || {}).filter(([key]) => presetRows[key])
    ),
    rows: presetRows,
  };

  fs.writeFileSync(presetPath, JSON.stringify(preset, null, 2) + "\n", "utf8");
  console.log(`Exported ${pinned.length} plots in ${Object.keys(presetRows).length} rows to ${presetPath}`);
  const missing = Object.keys(presetRows).filter((k) => !preset.rowConfigs[k]);
  if (missing.length) console.log(`Rows without a building config: ${missing.join(", ")}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
