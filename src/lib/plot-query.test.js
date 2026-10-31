import { describe, it, expect } from "vitest";
import { publicLayoutPlot } from "./plot-query";

describe("publicLayoutPlot", () => {
  it("keeps layout fields and tier numbers only", () => {
    const out = publicLayoutPlot({
      id: 7,
      plotNumber: "ROW-E02-C09-A",
      status: "occupied",
      totalTiers: 4,
      gpsLat: "8.46590000",
      gpsLng: "124.65700000",
      createdAt: new Date(),
      locationDetail: { subsection: "ROW-E02", capacity: 50, location: { name: "CMP" } },
      graves: [{ tier: 2, id: 99, deceasedName: "Private Person", details: { causeOfDeath: "x" } }],
    });
    expect(out).toEqual({
      id: 7,
      plotNumber: "ROW-E02-C09-A",
      status: "occupied",
      totalTiers: 4,
      gpsLat: 8.4659,
      gpsLng: 124.657,
      locationDetail: { subsection: "ROW-E02" },
      graves: [{ tier: 2 }],
    });
    expect(JSON.stringify(out)).not.toContain("Private Person");
  });
});
