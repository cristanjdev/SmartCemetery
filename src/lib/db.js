import { PrismaClient } from "@prisma/client";
import { phoneticIndexKey } from "./phonetic.mjs";

const globalForPrisma = globalThis;

// Keep graves.name_phonetic (the FULLTEXT-indexed search key) in step with
// deceasedName on every write, so no route has to remember to do it.
function withPhoneticKey(data) {
  const name = typeof data?.deceasedName === "object" ? data.deceasedName?.set : data?.deceasedName;
  if (typeof name !== "string") return data;
  return { ...data, namePhonetic: phoneticIndexKey(name) };
}

function createClient() {
  // namePhonetic is an internal search index, never part of an API response.
  return new PrismaClient({ omit: { grave: { namePhonetic: true } } }).$extends({
    query: {
      grave: {
        create({ args, query }) {
          return query({ ...args, data: withPhoneticKey(args.data) });
        },
        update({ args, query }) {
          return query({ ...args, data: withPhoneticKey(args.data) });
        },
        upsert({ args, query }) {
          return query({
            ...args,
            create: withPhoneticKey(args.create),
            update: withPhoneticKey(args.update),
          });
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
