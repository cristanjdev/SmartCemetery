/**
 * Gives every crypt plot a place on the map, following the drone photo.
 *
 * 1. Rows with no position at all go onto the directory blocks they are
 *    (ROW-W01 = FBN B20, ROW-W02 = FBN B19, ROW-W04 = FBN B16). Each block's
 *    columns are spread evenly along it from its far (south-west) end, C01
 *    first, like the mapped rows; front plots (A) on the south-east face and
 *    back plots (B) on the other, 1.4 m off the centre line. Missing columns
 *    are created as empty plots so the block is a whole row.
 * 2. Plots numbered past the real end of a mapped row (e.g. ROW-E06-C12 on an
 *    8-column row) do not exist on the ground: their graves move, tiers kept,
 *    to the vacant plot nearest that end of the same row and face, and the
 *    emptied plots are removed.
 *
 * Every change is written to a journal in /backups so it can be undone.
 *
 *   node scripts/place-unpositioned-plots.js                    # show what would change
 *   node scripts/place-unpositioned-plots.js --apply            # make the change
 *   node scripts/place-unpositioned-plots.js --undo <journal>   # put it back
 *
 * Afterwards remove the three rows from `deletedRows` in layout-preset.json and
 * run scripts/export-current-preset.js, so applying the preset keeps them.
 */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { loadEnvConfig } = require("@next/env");
const preset = require("../src/lib/layout-preset.json");
const { loadSite, blockPositions, plotNo } = require("./lib/directory-blocks");

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const UNDO_AT = process.argv.indexOf("--undo");
const UNDO_FILE = UNDO_AT >= 0 ? process.argv[UNDO_AT + 1] : null;

/** Rows with no position, and the directory block (site-surroundings.js) each one is. */
const ROW_BLOCKS = { "ROW-W01": "FBN B20", "ROW-W02": "FBN B19", "ROW-W04": "FBN B16" };

const parse = (plotNumber) => {
  const m = String(plotNumber).match(/^(ROW-[EW]\d+)-C(\d+)-([AB])$/i);
  return m ? { row: m[1].toUpperCase(), col: Number(m[2]), side: m[3].toUpperCase() } : null;
};
async function plan(location) {
  const { UNMAPPED_BLOCKS, SITE_ORIGIN } = await loadSite();
  const details = await prisma.locationDetail.findMany({
    where: { locationId: location.id },
    include: { plots: { include: { graves: { select: { id: true, tier: true } }, _count: { select: { photos: true } } } } },
  });
  const steps = { place: [], create: [], move: [], remove: [], skipped: [] };

  // 1. Whole rows onto their directory blocks.
  for (const [row, blockName] of Object.entries(ROW_BLOCKS)) {
    const spec = UNMAPPED_BLOCKS.find((b) => b.name === blockName);
    const detail = details.find((d) => d.subsection === row);
    if (!detail) {
      steps.skipped.push(`${row}: no such row`);
      continue;
    }
    const existing = new Map(detail.plots.map((p) => [p.plotNumber, p]));
    const maxCol = Math.max(0, ...detail.plots.map((p) => parse(p.plotNumber)?.col || 0));
    const { cols, positions } = blockPositions(spec, SITE_ORIGIN, maxCol);
    for (const pos of positions) {
      const number = plotNo(row, pos.col, pos.side);
      const plot = existing.get(number);
      if (plot) {
        if (plot.gpsLat == null) steps.place.push({ id: plot.id, plotNumber: number, lat: pos.lat, lng: pos.lng });
      } else {
        steps.create.push({ locationDetailId: detail.id, plotNumber: number, lat: pos.lat, lng: pos.lng });
      }
    }
    console.log(`${row} -> ${blockName}: ${cols} columns x 2 faces`);
  }

  // 2. Plots past the end of a mapped row.
  const taken = new Set();
  for (const detail of details) {
    if (ROW_BLOCKS[detail.subsection]) continue;
    const plots = detail.plots.filter((p) => parse(p.plotNumber));
    const onMap = plots.filter((p) => p.gpsLat != null);
    if (onMap.length === 0) continue;
    for (const extra of plots.filter((p) => p.gpsLat == null)) {
      const { row, col, side } = parse(extra.plotNumber);
      if (extra.graves.length > 0) {
        const tiers = extra.graves.map((g) => g.tier);
        const fits = (p) => !taken.has(p.id) && tiers.every((t) => t <= p.totalTiers && !p.graves.some((g) => g.tier === t));
        const nearEnd = (a, b) => parse(b.plotNumber).col - parse(a.plotNumber).col;
        const sameSide = onMap.filter((p) => parse(p.plotNumber).side === side && fits(p));
        // An empty plot on the same face, else one whose needed tiers are free,
        // else an empty plot on the other face of the same row.
        const target =
          sameSide.filter((p) => p.graves.length === 0 && p.status === "available").sort(nearEnd)[0] ||
          sameSide.filter((p) => p.graves.length > 0).sort(nearEnd)[0] ||
          onMap.filter((p) => parse(p.plotNumber).side !== side && fits(p) && p.graves.length === 0).sort(nearEnd)[0];
        if (!target) {
          steps.skipped.push(`${extra.plotNumber}: no vacant ${side} plot left in ${row}`);
          continue;
        }
        taken.add(target.id);
        steps.move.push({ from: extra.plotNumber, fromId: extra.id, to: target.plotNumber, toId: target.id, graves: extra.graves.map((g) => g.id) });
      }
      if (extra._count.photos > 0) {
        steps.skipped.push(`${extra.plotNumber}: kept, it has photos`);
        continue;
      }
      steps.remove.push({
        id: extra.id,
        locationDetailId: extra.locationDetailId,
        plotNumber: extra.plotNumber,
        status: extra.status,
        totalTiers: extra.totalTiers,
        col,
      });
    }
  }
  return steps;
}

async function apply(steps) {
  const journal = { at: new Date().toISOString(), placed: [], created: [], moved: [], removed: [] };
  await prisma.$transaction(async (tx) => {
    for (const s of steps.place) {
      await tx.plot.update({ where: { id: s.id }, data: { gpsLat: s.lat, gpsLng: s.lng } });
      journal.placed.push({ id: s.id });
    }
    for (const s of steps.create) {
      const plot = await tx.plot.create({
        data: { locationDetailId: s.locationDetailId, plotNumber: s.plotNumber, status: "available", totalTiers: 4, gpsLat: s.lat, gpsLng: s.lng },
      });
      journal.created.push({ id: plot.id });
    }
    for (const s of steps.move) {
      const before = await tx.plot.findUnique({ where: { id: s.toId }, select: { status: true } });
      await tx.grave.updateMany({ where: { id: { in: s.graves } }, data: { plotId: s.toId } });
      await tx.plot.updateMany({ where: { id: s.toId, status: "available" }, data: { status: "occupied" } });
      journal.moved.push({ graves: s.graves, from: s.from, toId: s.toId, toStatus: before.status });
    }
    for (const s of steps.remove) {
      await tx.plot.delete({ where: { id: s.id } });
      journal.removed.push(s);
    }
  });
  fs.mkdirSync(path.join(process.cwd(), "backups"), { recursive: true });
  const file = path.join("backups", `place-unpositioned-${journal.at.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(journal, null, 2));
  console.log(`Journal: ${file}`);
}

async function undo(file) {
  const journal = JSON.parse(fs.readFileSync(file, "utf8"));
  await prisma.$transaction(async (tx) => {
    const restored = new Map();
    for (const r of journal.removed) {
      const plot = await tx.plot.create({
        data: { locationDetailId: r.locationDetailId, plotNumber: r.plotNumber, status: r.status, totalTiers: r.totalTiers },
      });
      restored.set(r.plotNumber, plot.id);
    }
    for (const m of journal.moved) {
      await tx.grave.updateMany({ where: { id: { in: m.graves } }, data: { plotId: restored.get(m.from) } });
      await tx.plot.update({ where: { id: m.toId }, data: { status: m.toStatus } });
    }
    for (const c of journal.created) await tx.plot.delete({ where: { id: c.id } });
    for (const p of journal.placed) await tx.plot.update({ where: { id: p.id }, data: { gpsLat: null, gpsLng: null } });
  });
  console.log(`Undone: ${file}`);
}

async function main() {
  if (UNDO_FILE) return undo(UNDO_FILE);
  const wanted = process.env.LAYOUT_LOCATION_NAME || preset.location?.matchName;
  const location = await prisma.location.findFirst({ where: { name: { contains: wanted } } });
  if (!location) throw new Error(`No location matches "${wanted}".`);

  const steps = await plan(location);
  console.log(`\n${steps.place.length} plots get a position, ${steps.create.length} empty plots are created.`);
  for (const m of steps.move) console.log(`  move ${m.graves.length} grave(s): ${m.from} -> ${m.to}`);
  console.log(`${steps.remove.length} plots past a row's end are removed.`);
  for (const s of steps.skipped) console.log(`  skipped ${s}`);
  if (!APPLY) {
    console.log("Dry run: nothing was changed. Add --apply to make the change.");
    return;
  }
  await apply(steps);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
