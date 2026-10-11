import { doubleMetaphone } from "double-metaphone";

/**
 * Smart Search Engine
 * If exact match not found, suggests closest phonetic matches
 * Uses Double Metaphone algorithm for phonetic matching
 */

/**
 * Generate phonetic keys for a name
 */
export function getPhoneticKeys(name) {
  const words = name.trim().toLowerCase().split(/\s+/);
  return words.map((word) => doubleMetaphone(word)).flat();
}

/**
 * Calculate phonetic similarity score between two names (0-1)
 */
export function phoneticSimilarity(name1, name2) {
  const keys1 = getPhoneticKeys(name1);
  const keys2 = getPhoneticKeys(name2);

  if (keys1.length === 0 || keys2.length === 0) return 0;

  let matches = 0;
  for (const k1 of keys1) {
    for (const k2 of keys2) {
      if (k1 && k2 && k1 === k2) {
        matches++;
        break;
      }
    }
  }

  return matches / Math.max(keys1.length, keys2.length);
}

const GRAVE_INCLUDE = {
  plot: {
    include: {
      locationDetail: { include: { location: true } },
      photos: { select: { tier: true, url: true } },
    },
  },
  details: true,
};

function result(exact, suggestions, matchType, nearby = []) {
  return { exact, suggestions, matchType, nearby };
}

function compareNearby(a, b) {
  const sectionA = a.plot?.locationDetail?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const sectionB = b.plot?.locationDetail?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (sectionA !== sectionB) return sectionA - sectionB;
  const plotComparison = String(a.plot?.plotNumber || "").localeCompare(
    String(b.plot?.plotNumber || ""),
    undefined,
    { numeric: true }
  );
  return plotComparison || a.id - b.id;
}

async function nearbySectionSuggestions(prisma, suggestions) {
  const anchor = suggestions[0]?.plot?.locationDetail;
  if (!anchor || !Number.isInteger(anchor.locationId) || !Number.isInteger(anchor.sortOrder)) {
    return [];
  }

  // Use the generated LocationDetail.sortOrder field and its composite index to
  // choose only the immediately adjacent sections in deterministic order.
  const sections = await prisma.locationDetail.findMany({
    where: {
      locationId: anchor.locationId,
      sortOrder: { in: [anchor.sortOrder - 1, anchor.sortOrder + 1] },
    },
    select: { id: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    take: 2,
  });
  if (!sections.length) return [];

  const suggestionIds = suggestions.map((grave) => grave.id);
  const nearby = await prisma.grave.findMany({
    where: {
      id: { notIn: suggestionIds },
      plot: { locationDetailId: { in: sections.map((section) => section.id) } },
    },
    include: GRAVE_INCLUDE,
    orderBy: { id: "asc" },
    take: 30,
  });

  return nearby.sort(compareNearby).slice(0, 10);
}

/**
 * Search precedence: exact numeric ID, indexed burial-year range, name
 * contains, then a bounded phonetic fallback. Existing `exact` and
 * `suggestions` arrays remain stable; `matchType` identifies the branch and
 * `nearby` contains deterministic adjacent-section recommendations.
 */
export async function smartSearch(prisma, rawQuery) {
  const query = String(rawQuery ?? "").trim();
  if (!query) return result([], [], "none");

  // Wildcard query: "*" or "%" retrieves registry records
  if (query === "*" || query === "%" || query.toLowerCase() === "all") {
    const all = await prisma.grave.findMany({
      include: GRAVE_INCLUDE,
      orderBy: { id: "asc" },
      take: 60,
    });
    return result(all, [], "all");
  }

  // If query contains wildcard asterisks (e.g. "Rizal*"), clean it for contains matching
  const cleanQuery = query.replace(/\*+/g, "").trim();

  if (/^\d+$/.test(query)) {
    const id = Number(query);
    if (Number.isSafeInteger(id) && id > 0) {
      const grave = await prisma.grave.findUnique({
        where: { id },
        include: GRAVE_INCLUDE,
      });
      if (grave) return result([grave], [], "graveId");
    }
  }

  if (/^\d{4}$/.test(query)) {
    const year = Number(query);
    if (year >= 1000 && year <= 9998) {
      const exact = await prisma.grave.findMany({
        where: {
          burialDate: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
        include: GRAVE_INCLUDE,
        orderBy: [{ burialDate: "asc" }, { id: "asc" }],
        take: 20,
      });
      if (exact.length) return result(exact, [], "burialYear");
    }
  }

  const searchTerm = cleanQuery || query;
  const exact = await prisma.grave.findMany({
    where: { deceasedName: { contains: searchTerm } },
    include: GRAVE_INCLUDE,
    orderBy: { id: "asc" },
    take: 20,
  });
  if (exact.length) return result(exact, [], "name");

  // The fallback is deliberately bounded; never load the registry into memory.
  const candidates = await prisma.grave.findMany({
    include: GRAVE_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  const suggestions = candidates
    .map((grave) => ({
      ...grave,
      score: phoneticSimilarity(query, grave.deceasedName),
    }))
    .filter((grave) => grave.score > 0.3)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, 10);

  const nearby = await nearbySectionSuggestions(prisma, suggestions);
  return result([], suggestions, suggestions.length ? "phonetic" : "none", nearby);
}
