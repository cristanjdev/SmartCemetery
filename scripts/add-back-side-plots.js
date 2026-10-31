/**
 * Turns one-sided crypt rows into back-to-back blocks: every building plot
 * becomes the front face of its column ("ROW-E02-C09" → "ROW-E02-C09-A") and
 * gets an empty back-face plot ("ROW-E02-C09-B", same tiers, available).
 *
 * The row's line of plots is the block's centre line, so the front plot moves
 * half a face (1.4 m) to the front side and the back plot sits 1.4 m to the
 * other side, keeping the block where it was aligned. Graves stay on the
 * front plots. Rows that already have face letters are left alone.
 *
 *   node scripts/add-back-side-plots.js                 # show what would change
 *   node scripts/add-back-side-plots.js --apply         # make the change
 *   node scripts/add-back-side-plots.js --undo --apply  # remove empty back plots, restore front plots
 *
 * Location: LAYOUT_LOCATION_NAME, else the layout preset's location.matchName.
 */
const { PrismaClient } = require("@prisma/client");
const { loadEnvConfig } = require("@next/env");
const preset = require("../src/lib/layout-preset.json");

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.includes("--undo");
/** Half the 2.8 m face width: how far each face's plots sit from the centre line. */
const FACE_OFFSET_M = 1.4;
const LAT_M = 110574;
const lngM = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

/** Row direction (degrees counter-clockwise from east) fitted to its plots, as the map does. */
function rowAngle(points) {
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng0 = points.reduce((s, p) => s + p.lng, 0) / points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dy = (p.lat - lat0) * LAT_M;
    const dx = (p.lng - lng0) * lngM(lat0);
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
}

/** A point moved `dy` metres across a row at `angleDeg` (negative = front face, as building-grid's row 0). */
function across(p, dy, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return {
    lat: Number((p.lat + (dy * Math.cos(a)) / LAT_M).toFixed(8)),
    lng: Number((p.lng - (dy * Math.sin(a)) / lngM(p.lat)).toFixed(8)),
  };
}

async function main() {
  const wanted = process.env.LAYOUT_LOCATION_NAME || preset.location?.matchName;
  const location = await prisma.location.findFirst({ where: { name: { contains: wanted } } });
  if (!location) throw new Error(`No location matches "${wanted}".`);

  const details = await prisma.locationDetail.findMany({
    where: { locationId: location.id },
    include: { plots: { include: { _count: { select: { graves: true } } } } },
    orderBy: { sortOrder: "asc" },
  });

  let renamed = 0;
  let created = 0;
  let removed = 0;
  const ops = [];

  for (const detail of details) {
    const plots = detail.plots.filter((p) => p.totalTiers > 1);
    if (plots.length === 0) continue;
    const pinned = plots.filter((p) => p.gpsLat != null && p.gpsLng != null);
    const angle = pinned.length >= 2 ? rowAngle(pinned.map((p) => ({ lat: Number(p.gpsLat), lng: Number(p.gpsLng) }))) : 0;
    const hasFaces = plots.some((p) => /-[AB]$/i.test(p.plotNumber));

    if (!UNDO) {
      if (hasFaces) continue;
      for (const p of plots) {
        const pos = p.gpsLat != null ? { lat: Number(p.gpsLat), lng: Number(p.gpsLng) } : null;
        const front = pos ? across(pos, -FACE_OFFSET_M, angle) : null;
        const back = pos ? across(pos, FACE_OFFSET_M, angle) : null;
        ops.push(
          prisma.plot.update({
            where: { id: p.id },
            data: { plotNumber: `${p.plotNumber}-A`, ...(front ? { gpsLat: front.lat, gpsLng: front.lng } : {}) },
          }),
          prisma.plot.create({
            data: {
              locationDetailId: detail.id,
              plotNumber: `${p.plotNumber}-B`,
              status: "available",
              totalTiers: p.totalTiers,
              ...(back ? { gpsLat: back.lat, gpsLng: back.lng } : {}),
            },
          })
        );
        renamed++;
        created++;
      }
      console.log(`${detail.subsection}: ${plots.length} plots -> front (A) + new back (B)`);
    } else {
      if (!hasFaces) continue;
      for (const p of plots) {
        if (/-B$/i.test(p.plotNumber)) {
          if (p._count.graves > 0) {
            console.log(`  keep ${p.plotNumber}: it has graves`);
            continue;
          }
          ops.push(prisma.plot.delete({ where: { id: p.id } }));
          removed++;
        } else if (/-A$/i.test(p.plotNumber)) {
          const pos = p.gpsLat != null ? { lat: Number(p.gpsLat), lng: Number(p.gpsLng) } : null;
          const centre = pos ? across(pos, FACE_OFFSET_M, angle) : null;
          ops.push(
            prisma.plot.update({
              where: { id: p.id },
              data: { plotNumber: p.plotNumber.replace(/-A$/i, ""), ...(centre ? { gpsLat: centre.lat, gpsLng: centre.lng } : {}) },
            })
          );
          renamed++;
        }
      }
      console.log(`${detail.subsection}: back plots removed, front plots restored`);
    }
  }

  console.log(
    UNDO
      ? `\n${removed} empty back plots to remove, ${renamed} front plots to restore.`
      : `\n${renamed} plots to rename as front (A), ${created} back plots (B) to create.`
  );
  if (!APPLY) {
    console.log("Dry run: nothing was changed. Add --apply to make the change.");
    return;
  }
  await prisma.$transaction(ops);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
