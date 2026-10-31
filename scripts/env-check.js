/**
 * Next.js reads both `.env` and `.env.local`, and `.env.local` wins. When the
 * two files disagree about DATABASE_URL, the app silently uses `.env.local`'s
 * value, which looks like "my data disappeared" once the other file is edited.
 * The setup and migrate scripts call this to say so out loud.
 */
const fs = require("node:fs");
const path = require("node:path");

function readDatabaseUrl(file) {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    const match = text.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]*)"?\s*$/m);
    return match && match[1].trim() !== "" ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function mask(url) {
  return url.replace(/\/\/([^:@/]*):([^@]*)@/, (_all, user, pass) => `//${user}:${pass ? "****" : ""}@`);
}

/** A warning when `.env` and `.env.local` set different DATABASE_URLs, else null. */
function databaseUrlConflict() {
  const base = readDatabaseUrl(".env");
  const local = readDatabaseUrl(".env.local");
  if (!base || !local || base === local) return null;
  return (
    "⚠ DATABASE_URL is different in .env and .env.local:\n" +
    `    .env        ${mask(base)}\n` +
    `    .env.local  ${mask(local)}   ← this one is used (.env.local overrides .env)\n` +
    "  Keep DATABASE_URL in one file (.env.local) so the app and these scripts always agree."
  );
}

module.exports = { databaseUrlConflict };
