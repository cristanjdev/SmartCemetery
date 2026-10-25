import { doubleMetaphone } from "double-metaphone";

/**
 * Phonetic helpers shared by the app (src/lib/search.js, the grave routes) and
 * the maintenance scripts (scripts/backfill-phonetic.js). A `.mjs` module so
 * plain Node scripts can import it as well as Next.js and Vitest.
 */

/**
 * Generate phonetic keys for a name
 */
export function getPhoneticKeys(name) {
  const words = String(name ?? "").trim().toLowerCase().split(/\s+/);
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

// FULLTEXT ignores tokens shorter than 3 characters and Double Metaphone codes
// are often 1-2 characters ("R", "JS"), so every code is stored with this
// prefix. It also keeps codes clear of the English stop-word list.
const TOKEN_PREFIX = "zz";

/**
 * Searchable key for `graves.name_phonetic`: the distinct primary and
 * secondary Double Metaphone codes of each word, as space-separated tokens.
 * `phoneticIndexKey("Jose Rizal")` -> "zzhs zzrsl". The same function builds
 * the query string, so both sides always agree.
 */
export function phoneticIndexKey(name) {
  const tokens = new Set();
  for (const code of getPhoneticKeys(name)) {
    const clean = String(code ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (clean) tokens.add(TOKEN_PREFIX + clean);
  }
  return [...tokens].join(" ").slice(0, 500);
}
