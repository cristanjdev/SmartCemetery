/**
 * Loads a layout preset (see `layout-preset.json`) into the database. Shared by
 * `POST /api/plots/preset` and `prisma/seed.js`.
 *
 * Deliberately import-free so the CommonJS seed can load it with a plain
 * dynamic `import()`: the caller passes the Prisma client and the preset (and
 * optionally a tier count; by default the preset's own `tiersPerPlot`).
 *
 * The preset lays out plots — position and tier count. It never creates burial
 * records, and its per-plot status (from imagery) is applied only when a plot is
 * first created, so re-applying never overwrites real occupancy.
 *
 * @param {import("@prisma/client").PrismaClient} client
 * @param {object} preset parsed layout-preset.json
 * @param {number} [tiersOverride] tiers per plot (default: preset.tiersPerPlot)
 * @param {{ locationName?: string }} [options] `locationName` (e.g. from the
 *   LAYOUT_LOCATION_NAME environment variable) overrides the preset's location
 *   name, both for finding an existing location and for naming a new one, so a
 *   deployment never has to edit the preset file to attach it to its own site.
 * @returns {Promise<{ location: object, rowCount: number, totalPlots: number }>}
 */
/**
 * Renames rows the layout now calls by another name (`preset.renamedRows`,
 * e.g. "ROW-E05" → "FBN-B2", the printed directory's name): the section and
 * the start of every plot number in it ("ROW-E05-C03-A" → "FBN-B2-C03-A").
 * Burials, photos and history stay on their plots. Does nothing for a row
 * that is already renamed, or when both names exist (reported, not merged).
 *
 * @returns {Promise<Array<{ from: string, to: string, plots: number }>>} what was renamed
 */
/** AppSetting key holding the fingerprint of the last layout preset applied. */
export const LAYOUT_APPLIED_KEY = "layout_preset_applied";

/**
 * A short fingerprint of what a preset lays out (rows, plot numbers,
 * positions, renames). A database that has had this exact preset applied
 * keeps any changes made since (blocks moved with the Adjust tool, a pin
 * relocated) until a different preset ships.
 */
export function layoutFingerprint(preset) {
  const text = JSON.stringify([
    preset.renamedRows || {},
    preset.deletedRows || [],
    preset.tiersPerPlot,
    Object.entries(preset.rows || {}).map(([k, r]) => [k, r.plots.map((p) => [p.plotNumber, p.lat, p.lng])]),
  ]);
  // FNV-1a, 2 × 32 bits (no imports: the CommonJS seed loads this file too).
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The fingerprint of the preset last applied to this database, or null. */
export async function appliedLayoutFingerprint(client) {
  const row = await client.appSetting.findUnique({ where: { key: LAYOUT_APPLIED_KEY } }).catch(() => null);
  return row?.value ?? null;
}

export async function renameLayoutRows(client, preset, locationId) {
  const done = [];
  for (const [from, to] of Object.entries(preset.renamedRows || {})) {
    const old = await client.locationDetail.findFirst({ where: { locationId, subsection: from }, include: { plots: true } });
    if (!old) continue;
    const taken = await client.locationDetail.findFirst({ where: { locationId, subsection: to } });
    if (taken) {
      console.warn(`  ⚠ Both "${from}" and "${to}" exist; left as they are.`);
      continue;
    }
    await client.locationDetail.update({ where: { id: old.id }, data: { subsection: to } });
    for (const plot of old.plots) {
      if (plot.plotNumber === from || plot.plotNumber.startsWith(`${from}-`)) {
        await client.plot.update({ where: { id: plot.id }, data: { plotNumber: to + plot.plotNumber.slice(from.length) } });
      }
    }
    done.push({ from, to, plots: old.plots.length });
  }
  return done;
}

export async function applyLayoutPresetToDb(client, preset, tiersOverride, options = {}) {
  const tiers = tiersOverride ?? preset.tiersPerPlot;
  if (!Number.isInteger(tiers) || tiers < 1) {
    throw new Error("layout preset needs an integer tiersPerPlot (or an explicit tier count)");
  }
  const override = typeof options.locationName === "string" ? options.locationName.trim() : "";
  const loc = {
    ...(preset.location || {}),
    ...(override ? { name: override, matchName: override } : {}),
  };
  if (!loc.name) {
    throw new Error("layout preset has no location.name; set LAYOUT_LOCATION_NAME");
  }

  // 1. Find (or create) the location this layout belongs to.
  let location = loc.matchName
    ? await client.location.findFirst({ where: { name: { contains: loc.matchName } } })
    : null;
  if (!location) {
    location = await client.location.create({
      data: {
        name: loc.name,
        description: loc.description ?? null,
        gpsLat: loc.gpsLat ?? null,
        gpsLng: loc.gpsLng ?? null,
      },
    });
  } else if (location.gpsLat == null && location.gpsLng == null && loc.gpsLat != null && loc.gpsLng != null) {
    // Only fill in missing coordinates; never move an existing location.
    await client.location.update({
      where: { id: location.id },
      data: { gpsLat: loc.gpsLat, gpsLng: loc.gpsLng },
    });
  }

  // Rows the layout has renamed keep their plots under the new name.
  await renameLayoutRows(client, preset, location.id);

  // 2. Upsert each row (section) and its plots.
  const activePlotNumbers = new Set();
  const rowKeys = Object.keys(preset.rows);
  for (let rIdx = 0; rIdx < rowKeys.length; rIdx++) {
    const rowCode = rowKeys[rIdx];
    const rowData = preset.rows[rowCode];
    const sectionData = { capacity: rowData.plots.length * tiers, sortOrder: rIdx + 1 };

    let section = await client.locationDetail.findFirst({
      where: { locationId: location.id, subsection: rowCode },
    });
    if (!section) {
      section = await client.locationDetail.create({
        data: { locationId: location.id, subsection: rowCode, ...sectionData },
      });
    } else {
      await client.locationDetail.update({ where: { id: section.id }, data: sectionData });
    }

    for (const pDef of rowData.plots) {
      activePlotNumbers.add(pDef.plotNumber);
      await client.plot.upsert({
        where: {
          locationDetailId_plotNumber: { locationDetailId: section.id, plotNumber: pDef.plotNumber },
        },
        update: { gpsLat: pDef.lat, gpsLng: pDef.lng, totalTiers: tiers },
        create: {
          locationDetailId: section.id,
          plotNumber: pDef.plotNumber,
          status: pDef.status || "available",
          totalTiers: tiers,
          gpsLat: pDef.lat,
          gpsLng: pDef.lng,
        },
      });
    }
  }

  // Occupied plots are unpinned to the "unplaced" list; empty ones are removed.
  const retire = async (plot) => {
    if (plot.graves && plot.graves.length > 0) {
      await client.plot.update({ where: { id: plot.id }, data: { gpsLat: null, gpsLng: null } });
    } else {
      await client.plot.delete({ where: { id: plot.id } });
    }
  };

  // 3. Rows the layout retires.
  for (const delRow of preset.deletedRows || []) {
    const detail = await client.locationDetail.findFirst({
      where: { locationId: location.id, subsection: delRow },
      include: { plots: { include: { graves: true } } },
    });
    for (const p of detail?.plots || []) await retire(p);
  }

  // 4. Pinned plots in this location that the preset does not list.
  const pinned = await client.plot.findMany({
    where: { locationDetail: { locationId: location.id }, gpsLat: { not: null } },
    include: { graves: true },
  });
  for (const p of pinned) {
    if (!activePlotNumbers.has(p.plotNumber)) await retire(p);
  }

  // Remember which layout this database now has (see layoutFingerprint).
  const fingerprint = layoutFingerprint(preset);
  await client.appSetting.upsert({
    where: { key: LAYOUT_APPLIED_KEY },
    update: { value: fingerprint },
    create: { key: LAYOUT_APPLIED_KEY, value: fingerprint },
  });

  return { location, rowCount: rowKeys.length, totalPlots: activePlotNumbers.size };
}
