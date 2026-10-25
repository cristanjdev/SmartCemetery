/**
 * Fill graves.name_phonetic, the FULLTEXT-indexed Double Metaphone key behind
 * "did you mean" search suggestions.
 *
 * Run with:  npm run db:backfill-phonetic          (only rows still empty)
 *            npm run db:backfill-phonetic -- --all (recompute every row)
 *
 * Idempotent and safe to rerun. The app keeps the key current on every grave
 * create/update; this covers rows that predate the column and rows written by
 * the seed or other maintenance scripts.
 */
const { loadEnvConfig } = require("@next/env");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

loadEnvConfig(process.cwd());

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const { phoneticIndexKey } = await import(
    pathToFileURL(path.join(__dirname, "..", "src", "lib", "phonetic.mjs")).href
  );
  const prisma = new PrismaClient();
  const all = process.argv.includes("--all");

  try {
    const rows = await prisma.grave.findMany({
      where: all ? {} : { namePhonetic: "" },
      select: { id: true, deceasedName: true },
    });

    let updated = 0;
    for (const row of rows) {
      const key = phoneticIndexKey(row.deceasedName);
      if (!key) continue;
      // Raw update so the backfill does not touch the record's updated_at.
      await prisma.$executeRaw`UPDATE graves SET name_phonetic = ${key} WHERE id = ${row.id}`;
      updated += 1;
    }
    console.log(`✓ Phonetic search keys: ${updated} of ${rows.length} grave record(s) updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Phonetic backfill failed:", error.message);
  process.exit(1);
});
