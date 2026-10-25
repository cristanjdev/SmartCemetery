/**
 * One-command local database setup (XAMPP, MySQL, MariaDB, Docker, ...).
 *
 * Run with:  npm run db:setup
 *
 * It figures out your local database by itself, in this order:
 *   1. Uses DATABASE_URL from `.env` / `.env.local` / the environment if set.
 *   2. Otherwise scans localhost for a running MySQL/MariaDB (ports 3306-3310)
 *      and tries the stock login (user "root", no password).
 *   3. If the server wants a login, asks for it (nothing is guessed silently).
 *
 * Then, in order:
 *   - generates the Prisma client,
 *   - creates the database if it does not exist,
 *   - saves what it detected to `.env.local` (existing values are never
 *     overwritten) so `npm run dev` works straight away,
 *   - applies every migration,
 *   - seeds users (plus sample data and the layout preset on a local database),
 *   - fills the phonetic search index for existing records.
 *
 * Safe to run again at any time. Options (all optional):
 *   npm run db:setup -- --port=3307 --user=root --password=secret --db=cemetery_map
 *   npm run db:setup -- --url="mysql://user:pass@127.0.0.1:3306/cemetery_map"
 *   npm run db:setup -- --no-demo        users only, no sample burial records
 *   npm run db:setup -- --yes            never prompt (fail with a hint instead)
 *
 * Defaults below are for LOCAL DEVELOPMENT ONLY and are never applied to a
 * database that is not on this machine.
 */
const { loadEnvConfig } = require("@next/env");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const readline = require("node:readline");

loadEnvConfig(process.cwd());

// ─── Options ─────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/i.exec(arg);
    if (!m) continue;
    if (m[2] === undefined) out.flags.add(m[1]);
    else out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
// Connection flags mean "use exactly this", even when DATABASE_URL is already set.
const forced = ["url", "host", "port", "user", "password", "db"].some((key) => args[key] !== undefined);
const hadDatabaseUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !args.flags.has("yes");

// ─── Local-development defaults ──────────────────────────────

const DEFAULT_DB_NAME = "cemetery_map";
const SCAN_HOST = "127.0.0.1";
const SCAN_PORTS = [3306, 3307, 3308, 3309, 3310];

const DEV_DEFAULTS = {
  NEXTAUTH_URL: "http://localhost:3000",
  // Random per machine. Only sessions depend on it, so it is safe to generate.
  NEXTAUTH_SECRET: () => crypto.randomBytes(32).toString("hex"),
  // 32-byte (64 hex) AES key, fixed on purpose: a database seeded by an earlier
  // run keeps decrypting. Local dev only; never use it for real data.
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ENCRYPTION_KEY_VERSION: "v1",
  ENCRYPTION_KEY_PREVIOUS: "{}",
  // Seed accounts (min 12-character passwords required by the seed).
  SEED_ADMIN_EMAIL: "admin@cemetery.gov.ph",
  SEED_ADMIN_PASSWORD: "Password123!",
  SEED_STAFF_EMAIL: "staff@cemetery.gov.ph",
  SEED_STAFF_PASSWORD: "Password123!",
  SEED_CLIENT_EMAIL: "visitor@example.com",
  SEED_CLIENT_PASSWORD: "Password123!",
};
const SECRET_KEYS = new Set([
  "NEXTAUTH_SECRET",
  "ENCRYPTION_KEY",
  "SEED_ADMIN_PASSWORD",
  "SEED_STAFF_PASSWORD",
  "SEED_CLIENT_PASSWORD",
]);

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];
const isLocalUrl = (url) => {
  try {
    return LOCAL_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

// ─── Small helpers ───────────────────────────────────────────

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const maskUrl = (url) => url.replace(/:[^:@/]*@/, ":****@");

function buildUrl({ host = SCAN_HOST, port = 3306, user = "root", password = "", db = DEFAULT_DB_NAME }) {
  const auth = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  return `mysql://${auth}@${host}:${port}/${db}`;
}

const withDatabase = (url, db) => {
  const parsed = new URL(url);
  parsed.pathname = `/${db}`;
  return parsed.toString();
};

function ask(question, { hidden = false, fallback = "" } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim() || fallback);
    });
  });
}

function portOpen(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * Try one connection. Returns { state, version? } where state is:
 *   ok        logged in (version is set when the server answered)
 *   auth      reachable but the login was refused
 *   down      nothing is listening / cannot reach the server
 *   error     anything else (message included)
 */
async function probe(url) {
  const { PrismaClient } = require("@prisma/client");
  // Server-level database first (it always exists); the target database may not yet.
  const urls = [withDatabase(url, "mysql"), url];
  let last = { state: "error", message: "unknown" };

  for (const candidate of urls) {
    const client = new PrismaClient({ datasources: { db: { url: candidate } }, log: [] });
    try {
      const rows = await client.$queryRawUnsafe("SELECT VERSION() AS v");
      return { state: "ok", version: String(rows[0].v) };
    } catch (error) {
      // Connection failures are initialization errors that may carry no code,
      // so fall back to the message text.
      const code = error && (error.errorCode || error.code);
      const text = String(error && error.message);
      if (code === "P1000" || /valid database credentials|access denied|authentication failed/i.test(text)) {
        return { state: "auth" };
      }
      if (code === "P1001" || /can't reach database server|econnrefused|timed out/i.test(text)) {
        return { state: "down" };
      }
      // The login worked but this particular database is missing or off limits.
      if (code === "P1003" || code === "P1010") last = { state: "ok", version: null };
      else last = { state: "error", message: String(error && error.message).split("\n").pop() };
    } finally {
      await client.$disconnect().catch(() => {});
    }
  }
  return last;
}

function run(label, command, commandArgs, { optional = false, note = "" } = {}) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  const failed = Boolean(result.error) || result.status !== 0;
  if (failed && optional) {
    const reason = result.error ? result.error.message : `exit code ${result.status}`;
    console.warn(`\n⚠ ${label} was skipped (${reason}).`);
    if (note) console.warn(`  ${note}`);
    return false;
  }
  if (result.error) {
    console.error(`\n✖ ${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed (exit code ${result.status}).`);
    process.exit(result.status ?? 1);
  }
  return true;
}

function fail(lines) {
  console.error(`\n✖ ${lines[0]}`);
  for (const line of lines.slice(1)) console.error(`  ${line}`);
  process.exit(1);
}

// ─── 1. Find the database ────────────────────────────────────

async function resolveDatabaseUrl() {
  const dbName = args.db || DEFAULT_DB_NAME;
  const explicit = args.url || (forced ? "" : process.env.DATABASE_URL);

  if (explicit && explicit.trim() !== "") {
    const url = explicit.trim();
    const result = await probe(url);
    if (result.state === "ok") return { url, version: result.version, detected: Boolean(args.url) };

    const hints = [`Could not use DATABASE_URL (${maskUrl(url)}).`];
    if (result.state === "down") {
      hints.push("Nothing is answering at that host/port. Start MySQL (XAMPP: press Start next to MySQL).");
      if (isLocalUrl(url)) {
        const live = [];
        for (const port of SCAN_PORTS) if (await portOpen(SCAN_HOST, port)) live.push(port);
        if (live.length) hints.push(`A database IS listening on port ${live.join(", ")} — fix the port in DATABASE_URL.`);
      }
    } else if (result.state === "auth") {
      hints.push("The server refused that user/password. Fix DATABASE_URL in .env / .env.local.");
    } else {
      hints.push(result.message || "Unexpected error while connecting.");
    }
    fail(hints);
  }

  // Zero-config path: look for a local server.
  const host = args.host || SCAN_HOST;
  const ports = args.port ? [Number(args.port)] : SCAN_PORTS;
  const user = args.user || "root";
  let password = args.password ?? "";

  console.log(`\n🔎 No DATABASE_URL set — looking for MySQL/MariaDB on ${host} (ports ${ports.join(", ")})...`);
  const open = [];
  for (const port of ports) if (await portOpen(host, port)) open.push(port);

  if (open.length === 0) {
    fail([
      "No MySQL/MariaDB server found on this computer.",
      "Start it first (XAMPP: open the Control Panel and press Start next to MySQL),",
      "then run `npm run db:setup` again. If it runs elsewhere, pass --port=<port>",
      "or set DATABASE_URL in .env.local.",
    ]);
  }

  for (const port of open) {
    let currentUser = user;
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = buildUrl({ host, port, user: currentUser, password, db: dbName });
      const result = await probe(url);
      if (result.state === "ok") {
        console.log(`✓ Connected to ${result.version || "database server"} on ${host}:${port} as "${currentUser}".`);
        return { url, version: result.version, detected: true };
      }
      if (result.state !== "auth") {
        console.warn(`⚠ Port ${port} answered but is not usable (${result.message || result.state}).`);
        break;
      }
      if (!interactive) {
        fail([
          `A database is running on port ${port} but needs a login.`,
          `Run:  npm run db:setup -- --port=${port} --user=<user> --password=<password>`,
          "or put DATABASE_URL in .env.local.",
        ]);
      }
      console.log(`\nThe server on port ${port} needs a login (the stock "root" with no password was refused).`);
      currentUser = await ask(`  MySQL user [${currentUser}]: `, { fallback: currentUser });
      password = await ask("  MySQL password: ", { hidden: true });
    }
  }

  fail(["Could not log in to any local database server.", "Check the user/password and try again."]);
}

// ─── 2. Environment ──────────────────────────────────────────

function persistEnv(entries) {
  const keys = Object.keys(entries);
  if (keys.length === 0) return null;

  const file = process.env.SETUP_ENV_FILE || path.join(process.cwd(), ".env.local");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const missing = keys.filter((key) => !new RegExp(`^\\s*${key}\\s*=`, "m").test(existing));
  if (missing.length === 0) return null;

  const block =
    `${existing && !existing.endsWith("\n") ? "\n" : ""}` +
    `${existing ? "\n" : ""}# Added by \`npm run db:setup\` — local development values\n` +
    missing.map((key) => `${key}=${JSON.stringify(entries[key])}`).join("\n") +
    "\n";
  fs.appendFileSync(file, block);
  return { file, keys: missing };
}

function applyDefaults(isLocalDb) {
  const defaulted = {};
  const missingSecrets = [];

  for (const [key, value] of Object.entries(DEV_DEFAULTS)) {
    if (process.env[key] && process.env[key].trim() !== "") continue;
    if (!isLocalDb && SECRET_KEYS.has(key)) {
      missingSecrets.push(key);
      continue;
    }
    const resolved = typeof value === "function" ? value() : value;
    process.env[key] = resolved;
    defaulted[key] = resolved;
  }

  if (missingSecrets.length > 0) {
    fail([
      "DATABASE_URL does not point at a local database, so development defaults are not used.",
      `Set these explicitly first: ${missingSecrets.join(", ")}`,
    ]);
  }

  // Sample data (invented people, plots, requests) is a local-development
  // convenience. Elsewhere it must be requested explicitly.
  if (isLocalDb) {
    const demo = args.flags.has("no-demo") ? "no" : "yes";
    for (const key of ["SEED_DEMO_DATA", "SEED_LAYOUT_PRESET"]) {
      if (!process.env[key]) process.env[key] = demo;
    }
  }
  return defaulted;
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log("Smart Cemetery — local database setup");

  // The client must exist before we can talk to the database at all.
  run("1/5 Generating the Prisma client", npx, ["prisma", "generate"], {
    optional: true,
    note: "If the dev server is running, stop it and rerun. The client is normally generated during `npm install`.",
  });

  const found = await resolveDatabaseUrl();
  const isLocalDb = isLocalUrl(found.url);
  const dbName = new URL(found.url).pathname.replace(/^\//, "");

  if (!/^[A-Za-z0-9_$]+$/.test(dbName)) {
    fail([`Database name "${dbName}" has unsupported characters. Use letters, digits and underscores.`]);
  }

  // Older MySQL silently ignores CHECK constraints; everything else still works.
  const major = /^(\d+)\.(\d+)/.exec(found.version || "");
  if (major && !/mariadb/i.test(found.version) && (Number(major[1]) < 8)) {
    console.warn(`⚠ MySQL ${found.version} predates enforced CHECK constraints (8.0.16+). The app works, but the database will not enforce them.`);
  }

  console.log(`\n▶ 2/5 Preparing database \`${dbName}\``);
  {
    const { PrismaClient } = require("@prisma/client");
    const server = new PrismaClient({ datasources: { db: { url: withDatabase(found.url, "mysql") } }, log: [] });
    try {
      await server.$executeRawUnsafe(
        `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
      console.log(`✓ Database \`${dbName}\` is ready (${maskUrl(found.url)})`);
    } catch (error) {
      // Restricted users cannot create databases; migrate will report if it is truly missing.
      console.warn(`⚠ Could not auto-create the database (${String(error.message).split("\n").pop()}). Continuing.`);
    } finally {
      await server.$disconnect().catch(() => {});
    }
  }

  if (forced && hadDatabaseUrl && found.url !== process.env.DATABASE_URL) {
    console.log("ℹ Using the connection you passed for this run only; DATABASE_URL in your .env files is unchanged.");
  }
  process.env.DATABASE_URL = found.url;

  const defaults = applyDefaults(isLocalDb);
  const persisted = persistEnv({
    // Never repoint an app that already has a DATABASE_URL (a flag run is for this run only).
    ...(found.detected && !hadDatabaseUrl ? { DATABASE_URL: found.url } : {}),
    ...defaults,
  });
  if (persisted) {
    console.log(`✓ Saved ${persisted.keys.length} setting(s) to ${path.basename(persisted.file)}: ${persisted.keys.join(", ")}`);
  }

  run("3/5 Applying migrations", npx, ["prisma", "migrate", "deploy"]);
  run("4/5 Seeding baseline data", "node", ["prisma/seed.js"]);
  run("5/5 Building the phonetic search index", "node", ["scripts/backfill-phonetic.js"]);

  console.log("\n✅ Database ready.");
  console.log("\nLogin accounts (local development):");
  console.log(`  Admin  → ${process.env.SEED_ADMIN_EMAIL}  /  ${process.env.SEED_ADMIN_PASSWORD}`);
  console.log(`  Staff  → ${process.env.SEED_STAFF_EMAIL}  /  ${process.env.SEED_STAFF_PASSWORD}`);
  console.log(`  Client → ${process.env.SEED_CLIENT_EMAIL}  /  ${process.env.SEED_CLIENT_PASSWORD}`);
  if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
    console.log("\nNote: the interactive map needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local (see .env.example).");
  }
  console.log("\nStart the app with:  npm run dev");
}

main().catch((error) => {
  console.error("\n✖ Setup failed:", error && error.message ? error.message : error);
  process.exit(1);
});
