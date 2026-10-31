/**
 * Safe, robust cross-platform database migration script.
 * Executed via: npm run db:migrate
 *
 * Ensures:
 * 1. Environment variables from .env and .env.local are properly loaded.
 * 2. Target MySQL database exists (creates it if missing).
 * 3. All Prisma migrations are applied in sequence.
 * 4. The Prisma Client is generated and synchronized with latest schema.
 * 5. The cemetery layout is brought up to date (scripts/upgrade-layout.js:
 *    backup first, every burial kept); nothing happens when it already is.
 *
 * Missing packages (after pulling a version that added some) are installed
 * first, so after a pull this is the only command to run.
 *
 * It never writes site data: there is no default boundary or layout. The map
 * derives a boundary from the plots until an Admin saves one.
 */
const { loadEnvConfig } = require("@next/env");
const { spawnSync } = require("node:child_process");
const net = require("node:net");

loadEnvConfig(process.cwd());
{
  const conflict = require("./env-check").databaseUrlConflict();
  if (conflict) console.warn(`${conflict}
`);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

// Packages a newer version added (e.g. the 3D map) are installed first.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const wanted = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const missing = wanted.filter((name) => !fs.existsSync(path.join(process.cwd(), "node_modules", name, "package.json")));
  if (missing.length) {
    console.log(`▶ Installing ${missing.length} missing package(s): ${missing.join(", ")}`);
    const res = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (res.status !== 0) {
      console.error("✖ npm install failed; check the internet connection and run `npm run db:migrate` again.");
      process.exit(1);
    }
  }
}

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === "") {
  console.error("✖ DATABASE_URL is not set. Add it to .env / .env.local (see .env.example).");
  process.exit(1);
}

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "");
  } catch {
    return "(invalid DATABASE_URL)";
  }
})();

console.log("=================================================");
console.log("  Smart Cemetery — Database Migration & Sync");
console.log("=================================================");
console.log(`Target Database: ${dbName}`);
console.log(`Database URL:    ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ":****@")}\n`);

function portOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

// 0. Say plainly when nothing answers at the DATABASE_URL address. The usual
// causes are MySQL not started (XAMPP) or a URL copied from another computer
// that uses a different port.
async function ensureServerReachable() {
  let host;
  let port;
  try {
    const parsed = new URL(process.env.DATABASE_URL);
    host = parsed.hostname;
    port = Number(parsed.port || 3306);
  } catch {
    return; // Invalid URL: Prisma reports it.
  }
  if (await portOpen(host, port)) return;

  console.error(`✖ Nothing is answering at ${host}:${port}, so the migration cannot start.
`);
  if (["localhost", "127.0.0.1", "::1"].includes(host)) {
    const others = [];
    for (const candidate of [3306, 3307, 3308, 3309, 3310]) {
      if (candidate !== port && (await portOpen(host, candidate))) others.push(candidate);
    }
    if (others.length > 0) {
      console.error(
        `  MySQL IS running on port ${others.join(", ")}. Change the port in DATABASE_URL
` +
          `  (in .env or .env.local) to ${others[0]}, for example ...@${host}:${others[0]}/${dbName}, then run this again.`
      );
    } else {
      console.error(
        "  Start MySQL first: open the XAMPP Control Panel and press Start next to MySQL.\n" +
          "  The port is shown next to it (XAMPP default: 3306); DATABASE_URL must use that port."
      );
    }
  } else {
    console.error("  Check that the database server is running and reachable, and that DATABASE_URL is correct.");
  }
  process.exit(1);
}

// 1. Ensure MySQL Database Exists before deploying migrations
async function ensureDatabaseExists() {
  try {
    const parsed = new URL(process.env.DATABASE_URL);
    const authPart = parsed.password
      ? `${parsed.username || "root"}:${parsed.password}`
      : parsed.username || "root";
    const serverUrl = `${parsed.protocol}//${authPart}@${parsed.host}/mysql`;
    const { PrismaClient } = require("@prisma/client");
    const sysClient = new PrismaClient({ datasources: { db: { url: serverUrl } } });

    await sysClient.$executeRawUnsafe(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    console.log(`✓ Database \`${dbName}\` verified / ready`);
    await sysClient.$disconnect();
  } catch {
    // If connecting to /mysql fails (e.g. restrictive DB user permissions), proceed anyway
    // as the target database may already exist.
  }
}

async function main() {
  await ensureServerReachable();
  await ensureDatabaseExists();

  // 2. Deploy Prisma migrations
  console.log("\n▶ [1/3] Deploying database migrations...");
  const migrateRes = spawnSync(npx, ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (migrateRes.status !== 0) {
    console.error(`\n✖ Migration failed with exit code ${migrateRes.status}`);
    process.exit(migrateRes.status || 1);
  }

  // 3. Generate Prisma Client
  console.log("\n▶ [2/3] Synchronizing Prisma client...");
  const genRes = spawnSync(npx, ["prisma", "generate"], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (genRes.status !== 0) {
    console.warn(
      "\n⚠ Note: Prisma client generation encountered a file lock (common on Windows while `npm run dev` is active)."
    );
    console.warn("  If you see type errors, stop your dev server and restart `npm run dev`.");
  } else {
    console.log("✓ Prisma client synchronized successfully");
  }

  // 4. Fill the phonetic search index for any records that predate it (idempotent).
  console.log("\n▶ [3/3] Updating the phonetic search index...");
  const backfillRes = spawnSync("node", ["scripts/backfill-phonetic.js"], {
    stdio: "inherit",
    env: process.env,
  });
  if (backfillRes.status !== 0) {
    console.warn("\n⚠ Phonetic index update failed; run `npm run db:backfill-phonetic` once the database is reachable.");
  }

  // 5. Bring the cemetery layout up to date (backup first; burials kept).
  console.log("\n▶ Updating the cemetery layout...");
  const layoutRes = spawnSync(
    "node",
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/upgrade-layout.js", "--apply"],
    { stdio: "inherit", env: process.env }
  );
  if (layoutRes.status !== 0) {
    console.error("\n✖ The cemetery layout could not be updated (the database was left as it was). Fix the problem above and run `npm run db:migrate` again.");
    process.exit(1);
  }

  console.log("\n✅ Database is fully migrated, synchronized, and up to date!");
  console.log("Your database is ready.\n");
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
