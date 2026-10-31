/**
 * Turns the directory blocks that still have no plots (drawn from the drone
 * photo, e.g. FBN B21) into rows of plots, so they can be tapped, searched and
 * routed to like the others, and moves burials that sit on old sample plots
 * with no place on the map onto them.
 *
 * 1. Each block still drawn without plots becomes a row named after the
 *    directory ("FBN B21" → row FBN-B21, plots FBN-B21-C01-A …): columns
 *    spread evenly from its far end, both faces, 4 tiers, all available.
 * 2. Burials on one-tier plots that are not on the map (old sample sections)
 *    move, tier kept, to the front plots of those rows, one block at a time in
 *    turn; the emptied sample plots are removed.
 * A new row's capacity is its niches: plots x tiers, as the layout preset sets it.
 *
 * Every change is written to a journal in /backups so it can be undone.
 *
 *   node scripts/map-directory-blocks.js                    # show what would change
 *   node scripts/map-directory-blocks.js --apply            # make the change
 *   node scripts/map-directory-blocks.js --undo <journal>   # put it back
 *
 * Afterwards run scripts/export-current-preset.js so the layout preset keeps the rows.
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
const TIERS = 4;

/** "FBN B21" → "FBN-B21": the row key (location subsection) for a directory block. */
const rowKey = (name) => name.trim().replace(/\s+/g, "-").toUpperCase();

async function plan(location) {
  const site = await loadSite();
  const layout = site.buildSceneLayout({ preset });
  const stillDrawn = site.placeUnmappedBlocks(layout.ref, layout.blocks);

  const details = await prisma.locationDetail.findMany({ where: { locationId: location.id }, include: { _count: { select: { plots: true } } } });
  let sortOrder = Math.max(0, ...details.map((d) => d.sortOrder));
  const rows = [];
  for (const drawn of stillDrawn) {
    const block = site.UNMAPPED_BLOCKS.find((b) => b.name === drawn.name);
    const key = rowKey(block.name);
    if (details.some((d) => d.subsection === key)) continue;
    const { cols, positions } = blockPositions(block, site.SITE_ORIGIN);
    sortOrder += 1;
    rows.push({ key, name: block.name, cols, sortOrder, plots: positions.map((p) => ({ ...p, plotNumber: plotNo(key, p.col, p.side) })) });
    console.log(`${block.name} -> row ${key}: ${cols} columns x 2 faces`);
  }

  // Burials on one-tier plots with no place on the map.
  const stranded = await prisma.plot.findMany({
    where: { gpsLat: null, totalTiers: 1, graves: { some: {} } },
    include: { graves: { select: { id: true, tier: true } }, _count: { select: { photos: true } } },
    orderBy: { plotNumber: "asc" },
  });
  // Front plots of the new rows, taken one block at a time in turn.
  const fronts = rows.map((r) => r.plots.filter((p) => p.side === "A"));
  const queue = [];
  for (let i = 0; queue.length < stranded.length && i < Math.max(0, ...fronts.map((f) => f.length)); i += 1) {
    for (const f of fronts) if (f[i] && queue.length < stranded.length) queue.push(f[i].plotNumber);
  }
  const moves = stranded.map((plot, i) => ({ fromId: plot.id, from: plot.plotNumber, to: queue[i], graves: plot.graves, photos: plot._count.photos }));
  return { rows, moves, details };
}

async function apply(location, { rows, moves, details }) {
  const journal = { at: new Date().toISOString(), details: [], capacities: [], moved: [], removed: [] };
  await prisma.$transaction(async (tx) => {
    const created = new Map();
    for (const row of rows) {
      const detail = await tx.locationDetail.create({
        data: { locationId: location.id, subsection: row.key, sortOrder: row.sortOrder, capacity: row.plots.length * TIERS },
      });
      journal.details.push({ id: detail.id });
      for (const p of row.plots) {
        const plot = await tx.plot.create({
          data: { locationDetailId: detail.id, plotNumber: p.plotNumber, status: "available", totalTiers: TIERS, gpsLat: p.lat, gpsLng: p.lng },
        });
        created.set(p.plotNumber, plot.id);
      }
    }
    for (const m of moves) {
      const toId = created.get(m.to);
      if (!toId) continue;
      await tx.grave.updateMany({ where: { id: { in: m.graves.map((g) => g.id) } }, data: { plotId: toId } });
      await tx.plot.update({ where: { id: toId }, data: { status: "occupied" } });
      journal.moved.push({ graves: m.graves.map((g) => g.id), from: m.from });
      if (m.photos === 0) {
        const old = await tx.plot.findUnique({ where: { id: m.fromId } });
        await tx.plot.delete({ where: { id: m.fromId } });
        journal.removed.push({ locationDetailId: old.locationDetailId, plotNumber: old.plotNumber, status: old.status, totalTiers: old.totalTiers });
      }
    }
  });
  fs.mkdirSync(path.join(process.cwd(), "backups"), { recursive: true });
  const file = path.join("backups", `map-directory-blocks-${journal.at.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(journal, null, 2));
  console.log(`Journal: ${file}`);
}

async function undo(file) {
  const journal = JSON.parse(fs.readFileSync(file, "utf8"));
  await prisma.$transaction(async (tx) => {
    for (const r of journal.removed) {
      const plot = await tx.plot.create({ data: r });
      const move = journal.moved.find((m) => m.from === r.plotNumber);
      if (move) await tx.grave.updateMany({ where: { id: { in: move.graves } }, data: { plotId: plot.id } });
    }
    for (const c of journal.capacities) await tx.locationDetail.update({ where: { id: c.id }, data: { capacity: c.capacity } });
    for (const d of journal.details) {
      await tx.plot.deleteMany({ where: { locationDetailId: d.id } });
      await tx.locationDetail.delete({ where: { id: d.id } });
    }
  });
  console.log(`Undone: ${file}`);
}

async function main() {
  if (UNDO_FILE) return undo(UNDO_FILE);
  const wanted = process.env.LAYOUT_LOCATION_NAME || preset.location?.matchName;
  const location = await prisma.location.findFirst({ where: { name: { contains: wanted } } });
  if (!location) throw new Error(`No location matches "${wanted}".`);

  const steps = await plan(location);
  const plots = steps.rows.reduce((n, r) => n + r.plots.length, 0);
  console.log(`\n${steps.rows.length} rows with ${plots} plots to create.`);
  for (const m of steps.moves) console.log(`  move ${m.graves.length} grave(s): ${m.from} -> ${m.to ?? "(no free plot)"}`);
  if (!APPLY) {
    console.log("Dry run: nothing was changed. Add --apply to make the change.");
    return;
  }
  await apply(location, steps);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
