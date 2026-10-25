import { describe, expect, it } from "vitest";
import { phoneticIndexKey, phoneticSimilarity } from "@/lib/phonetic.mjs";

describe("phoneticIndexKey", () => {
  it("prefixes lower-cased Double Metaphone codes so FULLTEXT can index them", () => {
    expect(phoneticIndexKey("Jose Rizal")).toBe("zzhs zzrsl");
  });

  it("keeps primary and secondary codes and drops duplicates", () => {
    expect(phoneticIndexKey("Bonifacio").split(" ")).toEqual(["zzpnfs", "zzpnfx"]);
    expect(phoneticIndexKey("Jose Jose")).toBe("zzhs");
  });

  it("gives similar-sounding spellings overlapping tokens", () => {
    const a = new Set(phoneticIndexKey("Smith").split(" "));
    expect(phoneticIndexKey("Smyth").split(" ").some((t) => a.has(t))).toBe(true);
    expect(phoneticSimilarity("Smyth", "Smith")).toBeGreaterThan(0.3);
  });

  it("returns an empty key for blank input", () => {
    expect(phoneticIndexKey("")).toBe("");
    expect(phoneticIndexKey(null)).toBe("");
  });

  it("never exceeds the 500-character column", () => {
    expect(phoneticIndexKey("Alexander ".repeat(200)).length).toBeLessThanOrEqual(500);
  });
});
