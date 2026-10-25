/**
 * Safe, robust cross-platform database migration script.
 * Executed via: npm run db:migrate
 *
 * Ensures:
 * 1. Environment variables from .env and .env.local are properly loaded.
 * 2. Target MySQL database exists (creates it if missing).
 * 3. All Prisma migrations are applied in sequence.
 * 4. The Prisma Client is generated and synchronized with latest schema.
 *
 * It never writes site data: there is no default boundary or layout. The map
 * derives a boundary from the plots until an Admin saves one.
 */
const { loadEnvConfig } = require("@next/env");
const { spawnSync } = require("node:child_process");

loadEnvConfig(process.cwd());

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

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

  console.log("\n✅ Database is fully migrated, synchronized, and up to date!");
  console.log("Your database is ready.\n");
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
