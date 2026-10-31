/**
 * Brings an existing database up to the current cemetery layout
 * (src/lib/layout-preset.json), keeping every burial record.
 *
 *   npm run db:upgrade-layout                 # show what would change (changes nothing)
 *   npm run db:upgrade-layout -- --apply      # back up the database, then upgrade
 *   npm run db:upgrade-layout -- --check      # only say whether an upgrade is needed
 *
 * What it does, in one transaction:
 *   0. Rows the layout has renamed (`renamedRows`, e.g. ROW-E05 → FBN-B2, the
 *      printed directory's names) take the new name, plot numbers included.
 *   1. One-sided crypt plots ("ROW-E01-C01") become the front face of their
 *      block ("ROW-E01-C01-A"), keeping their burials, when the layout has
 *      that front plot; the back faces come from the layout.
 *   2. The layout is loaded: every row and plot is created or moved to its
 *      place (the same step as "Apply preset" on the dashboard).
 *   3. A burial whose crypt plot has no place in the layout (e.g. a column past
 *      the real end of its row) moves, tier kept, to a vacant plot in the same
 *      row: same face first, then the other face.
 *   4. A saved map boundary that leaves plots outside (drawn before the newer
 *      rows existed) is removed, so the map uses the cemetery's own outline;
 *      the old one is kept in /backups.
 * It runs only when this version ships a layout the database has not had yet
 * (a fingerprint is kept in app_settings), so changes an Admin makes on the
 * dashboard afterwards — blocks moved, pins relocated — are kept.
 * Burials are never deleted. Anything that cannot be placed is listed, to be
 * assigned on the dashboard (Graves → edit → plot).
 *
 * `npm run db:migrate` runs it with --apply after the migrations, so a client
 * only ever runs that one command.
 *
 * Before changing anything it saves a full database backup (mysqldump; set
 * MYSQLDUMP_PATH if it is installed somewhere unusual) to /backups. Without
 * mysqldump it saves a snapshot of everything the upgrade touches instead
 * (rows, plots, burial plot assignments, the saved boundary). Afterwards it
 * writes a list of every burial that moved plot, for staff.
 *
 * Location: LAYOUT_LOCATION_NAME, else the layout's location.matchName.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());
const { PrismaClient } = require("@prisma/client");
const preset = require("../src/lib/layout-preset.json");

const APPLY = process.argv.includes("--apply");
const CHECK = process.argv.includes("--check");
const SKIP_BACKUP = process.argv.includes("--skip-backup");
const prisma = new PrismaClient({ log: [] });
const BOUNDARY_KEY = "cmp_boundary_offsets";

/** Records that this database has the current layout (see layoutFingerprint). */
async function rememberLayout() {
  const { layoutFingerprint, LAYOUT_APPLIED_KEY } = await import("../src/lib/layout-preset-db.js");
  const value = layoutFingerprint(preset);
  await prisma.appSetting.upsert({ where: { key: LAYOUT_APPLIED_KEY }, update: { value }, create: { key: LAYOUT_APPLIED_KEY, value } });
}

/** The app's boundary helpers (ES modules), or null when jiti is not installed. */
async function boundaryTools() {
  try {
    const { createJiti } = require("jiti");
    const jiti = createJiti(__filename, { alias: { "@": path.join(__dirname, "..", "src") } });
    return await jiti.import("../src/lib/site-overlay.js");
  } catch {
    return null;
  }
}

/** The saved map boundary, when it leaves some plots outside; else null. */
async function staleBoundary(tools, plotsAfter) {
  if (!tools) return null;
  const setting = await prisma.appSetting.findUnique({ where: { key: BOUNDARY_KEY } }).catch(() => null);
  if (!setting) return null;
  let offsets;
  try {
    offsets = typeof setting.value === "string" ? JSON.parse(setting.value) : setting.value;
  } catch {
    return null;
  }
  const outside = tools.plotsOutsideBoundary(offsets, plotsAfter);
  return outside.length ? { value: setting.value, outside: outside.length } : null;
}

const FACE = /^(.*-C\d+)-([AB])$/i;
const ONE_SIDED = /^(.*-C\d+)$/i;
/** A plot number under its row's current name ("ROW-E05-C03-A" → "FBN-B2-C03-A"). */
const RENAMES = Object.entries(preset.renamedRows || {});
const renamed = (n) => {
  for (const [from, to] of RENAMES) if (n === from || String(n).startsWith(`${from}-`)) return to + n.slice(from.length);
  return n;
};

const parse = (n) => {
  const m = /^(.*)-C(\d+)-([AB])$/i.exec(n || "");
  return m ? { row: m[1], col: Number(m[2]), side: m[3].toUpperCase() } : null;
};

/** Everything the upgrade would do, worked out without changing anything. */
async function survey() {
  const wanted = (process.env.LAYOUT_LOCATION_NAME || preset.location?.matchName || "").trim();
  const location = wanted ? await prisma.location.findFirst({ where: { name: { contains: wanted } } }) : null;
  if (!location) return { location: null };

  const plots = await prisma.plot.findMany({
    where: { locationDetail: { locationId: location.id } },
    include: { graves: { select: { id: true, tier: true, deceasedName: true } }, _count: { select: { photos: true } }, locationDetail: { select: { subsection: true } } },
  });
  // Work out the rest as if the renamed rows already had their new names.
  const sections = new Set(
    (await prisma.locationDetail.findMany({ where: { locationId: location.id }, select: { subsection: true } })).map((d) => d.subsection)
  );
  const renames = RENAMES.filter(([from, to]) => sections.has(from) && !sections.has(to)).map(([from, to]) => ({ from, to }));
  const willRename = (n) => (renames.some((r) => n === r.from || n.startsWith(`${r.from}-`)) ? renamed(n) : n);
  for (const p of plots) p.plotNumber = willRename(p.plotNumber);
  const byNumber = new Map(plots.map((p) => [p.plotNumber, p]));
  const layout = new Map();
  for (const row of Object.values(preset.rows)) for (const p of row.plots) layout.set(p.plotNumber, p);

  // 1. One-sided plots that become a front face.
  const toFront = plots.filter((p) => p.totalTiers > 1 && ONE_SIDED.test(p.plotNumber) && !FACE.test(p.plotNumber) && layout.has(`${p.plotNumber}-A`) && !byNumber.has(`${p.plotNumber}-A`));
  // 2. Layout plots that are missing or not where the layout puts them.
  const missing = [...layout.keys()].filter((n) => !byNumber.has(n) && !toFront.some((p) => `${p.plotNumber}-A` === n));
  const moved = [...layout.values()].filter((d) => {
    const p = byNumber.get(d.plotNumber);
    return p && (p.gpsLat == null || Math.abs(Number(p.gpsLat) - d.lat) > 1e-7 || Math.abs(Number(p.gpsLng) - d.lng) > 1e-7);
  });
  // 3. Crypt plots with burials that the layout has no place for.
  const homeless = plots.filter(
    (p) => p.totalTiers > 1 && p.graves.length > 0 && !layout.has(p.plotNumber) && !toFront.includes(p)
  );
  const tools = await boundaryTools();
  const allPlots = (await prisma.plot.findMany({ select: { plotNumber: true, gpsLat: true, gpsLng: true, totalTiers: true } })).map((p) => ({
    ...p,
    plotNumber: willRename(p.plotNumber),
  }));
  const layoutPlots = [...layout.values()].map((d) => ({ plotNumber: d.plotNumber, gpsLat: d.lat, gpsLng: d.lng, totalTiers: 4 }));
  const others = allPlots.filter((p) => !layout.has(p.plotNumber) && !layout.has(`${p.plotNumber}-A`));
  const boundary = await staleBoundary(tools, [...layoutPlots, ...others]);
  const needed = renames.length + toFront.length + missing.length + moved.length + homeless.length > 0 || Boolean(boundary);
  return { location, plots, layout, renames, toFront, missing, moved, homeless, boundary, needed };
}

function findMysqldump() {
  const candidates = [
    ...(process.env.MYSQLDUMP_PATH ? [process.env.MYSQLDUMP_PATH] : []),
    "mysqldump",
    "C:\\xampp\\mysql\\bin\\mysqldump.exe",
    ...["8.4", "8.0", "5.7"].map((v) => `C:\\Program Files\\MySQL\\MySQL Server ${v}\\bin\\mysqldump.exe`),
    "C:\\Program Files\\MariaDB 11.4\\bin\\mysqldump.exe",
    "/usr/bin/mysqldump",
    "/usr/local/bin/mysqldump",
    "/opt/homebrew/bin/mysqldump",
  ];
  return candidates.find((c) => spawnSync(c, ["--version"], { stdio: "ignore" }).status === 0) || null;
}

function backup(stamp) {
  const url = new URL(process.env.DATABASE_URL);
  const tool = findMysqldump();
  if (!tool) return null;
  fs.mkdirSync("backups", { recursive: true });
  const file = path.join("backups", `before-layout-upgrade-${stamp}.sql`);
  const base = ["-h", url.hostname, "-P", url.port || "3306", "-u", decodeURIComponent(url.username), "--single-transaction", "--routines"];
  const env = { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) };
  // MySQL 8's mysqldump against MariaDB (e.g. XAMPP) needs --column-statistics=0;
  // MariaDB's own mysqldump does not know that option, so try both.
  let res;
  for (const extra of [["--column-statistics=0"], []]) {
    const out = fs.openSync(file, "w");
    res = spawnSync(tool, [...base, ...extra, url.pathname.slice(1)], { stdio: ["ignore", out, "pipe"], env });
    fs.closeSync(out);
    if (res.status === 0 && fs.statSync(file).size > 0) break;
  }
  if (res.status !== 0 || fs.statSync(file).size === 0) {
    fs.rmSync(file, { force: true });
    throw new Error(`mysqldump failed: ${String(res.stderr || "").trim().split(/\r?\n/).pop()}`);
  }
  return file;
}

/**
 * Backup without mysqldump: everything the upgrade can change, as JSON — the
 * rows and plots of every location, which plot each burial is on, and the
 * saved settings.
 */
async function snapshot(stamp) {
  const data = {
    at: new Date().toISOString(),
    locationDetails: await prisma.locationDetail.findMany(),
    plots: await prisma.plot.findMany(),
    graves: await prisma.grave.findMany({ select: { id: true, plotId: true, tier: true, deceasedName: true } }),
    appSettings: await prisma.appSetting.findMany(),
  };
  fs.mkdirSync("backups", { recursive: true });
  const file = path.join("backups", `before-layout-upgrade-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(data, (k, v) => (typeof v === "bigint" ? Number(v) : v), 2));
  return file;
}

/** A vacant plot in the same row for burials whose plot is not in the layout. */
function pickHome(homeless, rowPlots, taken) {
  const want = parse(homeless.plotNumber) || { side: "A" };
  const tiers = homeless.graves.map((g) => g.tier);
  const fits = (p) => !taken.has(p.id) && tiers.every((t) => t <= p.totalTiers && !p.graves.some((g) => g.tier === t));
  const byEnd = (a, b) => (parse(b.plotNumber)?.col || 0) - (parse(a.plotNumber)?.col || 0);
  const same = rowPlots.filter((p) => parse(p.plotNumber)?.side === want.side && fits(p));
  return (
    same.filter((p) => p.graves.length === 0).sort(byEnd)[0] ||
    same.sort(byEnd)[0] ||
    rowPlots.filter((p) => parse(p.plotNumber)?.side !== want.side && fits(p) && p.graves.length === 0).sort(byEnd)[0] ||
    null
  );
}

async function upgrade(s, stamp) {
  const moves = [];
  const leftOver = [];
  await prisma.$transaction(
    async (tx) => {
      // 0. New row names (the printed directory's).
      const { renameLayoutRows } = await import("../src/lib/layout-preset-db.js");
      await renameLayoutRows(tx, preset, s.location.id);
      // 1. Front faces.
      for (const p of s.toFront) {
        await tx.plot.update({ where: { id: p.id }, data: { plotNumber: `${p.plotNumber}-A` } });
      }
      // 2. The layout.
      const { applyLayoutPresetToDb } = await import("../src/lib/layout-preset-db.js");
      await applyLayoutPresetToDb(tx, preset, undefined, { locationName: process.env.LAYOUT_LOCATION_NAME });
      // 3. Burials on plots the layout has no place for.
      const plots = await tx.plot.findMany({
        where: { locationDetail: { locationId: s.location.id } },
        include: { graves: { select: { id: true, tier: true, deceasedName: true } }, _count: { select: { photos: true } } },
      });
      const taken = new Set();
      for (const h of plots.filter((p) => p.totalTiers > 1 && p.graves.length > 0 && !s.layout.has(p.plotNumber))) {
        const row = parse(h.plotNumber)?.row || h.plotNumber.replace(/-C\d+$/i, "");
        const rowPlots = plots.filter((p) => s.layout.has(p.plotNumber) && parse(p.plotNumber)?.row === row);
        const home = pickHome(h, rowPlots, taken);
        if (!home) {
          leftOver.push(h);
          continue;
        }
        taken.add(home.id);
        await tx.grave.updateMany({ where: { id: { in: h.graves.map((g) => g.id) } }, data: { plotId: home.id } });
        await tx.plot.update({ where: { id: home.id }, data: { status: "occupied" } });
        home.graves.push(...h.graves);
        for (const g of h.graves) moves.push({ graveId: g.id, name: g.deceasedName, tier: g.tier, from: h.plotNumber, to: home.plotNumber });
        if (h._count.photos === 0) await tx.plot.delete({ where: { id: h.id } });
      }
    },
    { timeout: 300000, maxWait: 30000 }
  );
  if (moves.length) {
    const file = path.join("backups", `layout-upgrade-moved-burials-${stamp}.json`);
    fs.mkdirSync("backups", { recursive: true });
    fs.writeFileSync(file, JSON.stringify(moves, null, 2));
    console.log(`\n${moves.length} burial(s) moved to a real plot in the same row; list saved to ${file}:`);
    for (const m of moves) console.log(`  ${m.name}: ${m.from} -> ${m.to} (tier ${m.tier})`);
  }
  for (const h of leftOver) console.log(`  ⚠ No free plot in its row for ${h.plotNumber}; assign its burial(s) on the dashboard.`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.example).");
  const { layoutFingerprint, appliedLayoutFingerprint } = await import("../src/lib/layout-preset-db.js");
  if ((await appliedLayoutFingerprint(prisma)) === layoutFingerprint(preset)) {
    console.log(`✓ Cemetery layout is up to date (${Object.keys(preset.rows).length} rows; changes made on the dashboard are kept).`);
    return;
  }
  const s = await survey();
  if (!s.location) {
    console.log("No cemetery layout in this database yet. Run `npm run db:setup` to load it.");
    return;
  }
  const rows = Object.keys(preset.rows).length;
  const total = s.layout.size;
  if (!s.needed) {
    // Already matches this layout (e.g. set up before fingerprints were kept): just remember it.
    if (APPLY) await rememberLayout();
    console.log(`✓ Cemetery layout is up to date (${rows} rows, ${total} plots).`);
    return;
  }
  console.log(`Cemetery layout update for "${s.location.name}" → ${rows} rows, ${total} plots:`);
  if (s.renames.length) {
    console.log(`  • ${s.renames.length} rows take their directory names (plot numbers too): ${s.renames.map((r) => `${r.from} → ${r.to.replace("-", " ")}`).join(", ")}`);
  }
  if (s.toFront.length) console.log(`  • ${s.toFront.length} one-sided plots become front faces (-A), keeping their burials`);
  if (s.missing.length) console.log(`  • ${s.missing.length} plots added (back faces and new rows)`);
  if (s.moved.length) console.log(`  • ${s.moved.length} plots moved to their place on the map`);
  if (s.homeless.length) {
    const n = s.homeless.reduce((sum, p) => sum + p.graves.length, 0);
    console.log(`  • ${n} burial(s) on ${s.homeless.length} plot(s) that do not exist on the ground move to a vacant plot in the same row`);
  }
  if (s.boundary) {
    console.log(`  • the saved map boundary leaves ${s.boundary.outside} plot(s) outside; it is replaced by the cemetery's own outline (an Admin can adjust it again)`);
  }
  if (CHECK) {
    console.log("\nRun `npm run db:upgrade-layout` to see the details, then `npm run db:upgrade-layout -- --apply`.");
    return;
  }
  if (!APPLY) {
    console.log("\nNothing was changed. To upgrade (a backup is taken first): npm run db:upgrade-layout -- --apply");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (!SKIP_BACKUP) {
    let file = null;
    try {
      file = process.env.MYSQLDUMP_PATH === "none" ? null : backup(stamp);
    } catch (err) {
      console.warn(`⚠ ${err.message}; saving a snapshot of the layout data instead.`);
    }
    file = file || (await snapshot(stamp));
    console.log(`\n✓ Backup saved: ${file}`);
  }
  await upgrade(s, stamp);
  if (s.boundary) {
    fs.mkdirSync("backups", { recursive: true });
    const file = path.join("backups", `old-map-boundary-${stamp}.json`);
    fs.writeFileSync(file, typeof s.boundary.value === "string" ? s.boundary.value : JSON.stringify(s.boundary.value));
    await prisma.appSetting.delete({ where: { key: BOUNDARY_KEY } });
    console.log(`\n✓ Map boundary now follows the cemetery's outline (the old one is saved in ${file}).`);
  }
  const after = await survey();
  console.log(after.needed ? "\n⚠ Some changes could not be made; run again to see what is left." : `\n✓ Cemetery layout upgraded (${rows} rows, ${total} plots).`);
  const offMap = await prisma.grave.count({ where: { plot: { gpsLat: null } } });
  if (offMap) console.log(`ℹ ${offMap} burial record(s) are on plots with no place on the map; assign them on the dashboard (Graves → edit → plot).`);
}

main()
  .catch((err) => {
    console.error(`✖ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
