/**
 * Read-only list of the accounts in the configured database (no passwords or
 * hashes). Use it when sign-in says "Invalid email or password" to see which
 * emails really exist and whether they are active.
 *
 *   npm run db:users
 *
 * If the account you expect is missing, run `npm run db:setup`: it creates
 * the admin, staff and visitor accounts and prints their email and password.
 */
const { PrismaClient } = require("@prisma/client");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    orderBy: { id: "asc" },
    select: { id: true, email: true, name: true, status: true, userType: { select: { typeName: true } } },
  });

  if (users.length === 0) {
    console.log("No accounts yet. Run `npm run db:setup` to create the admin, staff and visitor accounts.");
    return;
  }

  console.log(`\n${users.length} account${users.length === 1 ? "" : "s"}:\n`);
  const width = Math.max(...users.map((u) => u.email.length), 5);
  for (const u of users) {
    console.log(`  ${u.email.padEnd(width)}  ${u.userType.typeName.padEnd(7)}  ${u.status}`);
  }
  if (users.some((u) => u.status !== "active")) {
    console.log("\nAccounts that are not 'active' cannot sign in.");
  }
  console.log(
    "\nSign in with one of the emails above. Passwords are never shown; `npm run db:setup`\n" +
      "resets the three default accounts and prints their credentials.\n"
  );
}

main()
  .catch((error) => {
    console.error("Could not read the accounts:", error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
