import { describe, it, expect } from "vitest";
import {
  formatPlotDate,
  getOrdinal,
  getInitials,
  extractPlotTiers,
  getPlotSummaryNames,
  getPlotOccupantNames,
  getPlotPhoto,
  statusMeta,
  getGravePhoto,
  tierLabel,
  tierLevelName,
  tierAvailability,
  hasVacantTier,
  canAddGrave,
  describeGravePosition,
  tierOccupancy,
  mapPlotStatus,
  matchesStatusFilter,
} from "./plot-format";

describe("plot-format", () => {
  it("formats dates in UTC so date-only values never shift a day", () => {
    expect(formatPlotDate("2021-10-14")).toBe("October 14th, 2021");
    expect(formatPlotDate("2018-03-20T00:00:00.000Z")).toBe("March 20th, 2018");
    // Late-UTC timestamp would render the previous day under local getters in
    // negative-UTC timezones; UTC getters keep it correct.
    expect(formatPlotDate("2018-01-01T23:30:00.000Z")).toBe("January 1st, 2018");
  });

  it("returns placeholders for empty/undefined and raw input for invalid", () => {
    expect(formatPlotDate("")).toBe("—");
    expect(formatPlotDate(null)).toBe("—");
    expect(formatPlotDate(undefined)).toBe("—");
    expect(formatPlotDate("not-a-date")).toBe("not-a-date");
  });

  it("appends correct ordinal suffixes", () => {
    expect(getOrdinal(1)).toBe("1st");
    expect(getOrdinal(2)).toBe("2nd");
    expect(getOrdinal(3)).toBe("3rd");
    expect(getOrdinal(4)).toBe("4th");
    expect(getOrdinal(11)).toBe("11th");
    expect(getOrdinal(22)).toBe("22nd");
    expect(getOrdinal(103)).toBe("103rd");
  });

  it("derives initials", () => {
    expect(getInitials("Beatriz Walag")).toBe("BW");
    expect(getInitials("Madonna")).toBe("MA");
    expect(getInitials("")).toBe("?");
    expect(getInitials(null)).toBe("?");
  });


  it("labels tiers for single lots and stacks", () => {
    expect(tierLabel(1, 1)).toBe("Ground Burial Lot");
    expect(tierLabel(1, 4)).toBe("Tier 1 (Ground Level)");
    expect(tierLabel(3, 4)).toBe("Tier 3 (Third Level)");
    expect(tierLabel(4, 4)).toBe("Tier 4 (Top Level)");
  });

  it("derives tiers from real grave rows and never fabricates occupants", () => {
    const plot = {
      plotNumber: "ROW-W07-C01",
      locationDetail: { subsection: "ROW-W07" },
      totalTiers: 4,
      status: "occupied",
      graves: [
        {
          id: 1,
          tier: 1,
          status: "active",
          deceasedName: "Real Person",
          burialDate: "2020-01-01",
          birthDate: "1940-02-15",
          deathDate: "2020-01-01",
          details: { causeOfDeath: "x", contactPerson: "Kin", notes: "remarks" },
        },
      ],
    };
    const tiers = extractPlotTiers(plot);
    expect(tiers).toHaveLength(4);
    const occupant = tiers.find((t) => t.status === "occupied");
    expect(occupant).toMatchObject({
      id: 1,
      deceasedName: "Real Person",
      birthDate: "1940-02-15",
      deathDate: "2020-01-01",
      notes: "remarks",
    });
    expect(tiers.filter((t) => t.status === "available")).toHaveLength(3);
    expect(formatPlotDate(occupant.birthDate)).toBe("February 15th, 1940");
  });

  it("uses Plot.totalTiers and treats a plot with no grave as available", () => {
    expect(extractPlotTiers({ plotNumber: "A-1", totalTiers: 1, status: "available", graves: [] })).toEqual([
      { tier: 1, label: "Ground Burial Lot", status: "available", photo: null },
    ]);
    expect(extractPlotTiers({ plotNumber: "A-1", totalTiers: 3, graves: [] })).toHaveLength(3);
    expect(extractPlotTiers(null)).toEqual([]);
  });

  it("never shows fewer tiers than the highest grave tier", () => {
    const plot = { plotNumber: "A-1", totalTiers: 1, graves: [{ id: 1, tier: 3, deceasedName: "X", status: "active" }] };
    expect(extractPlotTiers(plot)).toHaveLength(3);
  });

  it("resolves tier photos from PlotPhoto rows with plot-wide fallback", () => {
    const plot = {
      plotNumber: "ROW-1",
      totalTiers: 4,
      photos: [
        { tier: 0, url: "/plot.jpg" },
        { tier: 2, url: "/t2.jpg" },
      ],
      graves: [],
    };
    const tiers = extractPlotTiers(plot);
    expect(tiers.find((t) => t.tier === 2).photo).toBe("/t2.jpg");
    expect(tiers.find((t) => t.tier === 1).photo).toBe("/plot.jpg");
    expect(getPlotPhoto(plot)).toBe("/plot.jpg");
    expect(getPlotPhoto({})).toBeNull();
  });

  it("gets a grave's photo from its plot's photos", () => {
    const grave = { tier: 2, plot: { photos: [{ tier: 0, url: "/p.jpg" }, { tier: 2, url: "/t2.jpg" }] } };
    expect(getGravePhoto(grave)).toBe("/t2.jpg");
    expect(getGravePhoto({ tier: 3, plot: grave.plot })).toBe("/p.jpg");
    expect(getGravePhoto(null)).toBeNull();
    expect(getGravePhoto({})).toBeNull();
  });

  it("lists occupant names in tier order and splits a single combined name", () => {
    expect(
      getPlotOccupantNames({ graves: [{ tier: 2, deceasedName: "B" }, { tier: 1, deceasedName: "A" }] })
    ).toEqual(["A", "B"]);
    expect(getPlotOccupantNames({ graves: [{ deceasedName: "A & B" }] })).toEqual(["A", "B"]);
    expect(getPlotOccupantNames({ graves: [{ deceasedName: "A / B" }] })).toEqual(["A", "B"]);
    expect(getPlotOccupantNames({ graves: [{ deceasedName: "A and B" }] })).toEqual(["A", "B"]);
    expect(getPlotOccupantNames({ graves: [] })).toEqual([]);
  });

  it("summary names fall back to the plot number", () => {
    expect(getPlotSummaryNames({ plotNumber: "X", graves: [] })).toEqual(["Plot X"]);
    expect(getPlotSummaryNames({ plotNumber: "X", graves: [{ deceasedName: "A" }] })).toEqual(["A"]);
    expect(getPlotSummaryNames(null)).toEqual([]);
  });

  it("maps statuses to presentation metadata with a safe default", () => {
    expect(statusMeta("occupied").label).toBe("Occupied");
    expect(statusMeta("available").label).toBe("Available");
    expect(statusMeta("reserved").label).toBe("Reserved");
    expect(statusMeta("maintenance").label).toBe("Maintenance");
    expect(statusMeta("something-else").label).toBe("Unavailable");
  });

  describe("describing where a grave is", () => {
    const crypt = (over = {}) => ({
      tier: 2,
      plot: { plotNumber: "ROW-E01-C04", totalTiers: 4, locationDetail: { subsection: "ROW-E01" }, ...over },
    });

    it("gives the row, column and tier of a building plot", () => {
      expect(describeGravePosition(crypt())).toEqual({
        row: "Row E01",
        column: "4",
        tier: "Tier 2 (Second Level)",
        text: "Row E01 · Column 4 · Tier 2 (Second Level)",
      });
    });

    it("reads the column from the end of the number, whatever the prefix", () => {
      const p = describeGravePosition({ tier: 1, plot: { plotNumber: "WALAG-001", totalTiers: 4, locationDetail: { subsection: "ROW-W07" } } });
      expect(p.text).toBe("Row W07 · Column 1 · Tier 1 (Ground Level)");
    });

    it("names the top tier, and works for any tier count", () => {
      expect(describeGravePosition(crypt({ totalTiers: 3 })).tier).toBe("Tier 2 (Second Level)");
      expect(describeGravePosition({ ...crypt({ totalTiers: 3 }), tier: 3 }).tier).toBe("Tier 3 (Top Level)");
    });

    it("describes an ordinary lot by section and plot, with no tier", () => {
      const p = describeGravePosition({ tier: 1, plot: { plotNumber: "A1-009", totalTiers: 1, locationDetail: { subsection: "A1" } } });
      expect(p).toEqual({ row: "A1", column: null, tier: null, text: "A1 · Plot A1-009" });
    });

    it("copes with missing pieces", () => {
      expect(describeGravePosition(null)).toBeNull();
      expect(describeGravePosition({ tier: 1 })).toBeNull();
      expect(describeGravePosition(crypt({ locationDetail: undefined })).text).toBe("Column 4 · Tier 2 (Second Level)");
    });
  });

  describe("adding records to tiers", () => {
    const crypt = {
      id: 1,
      plotNumber: "C-1",
      status: "occupied",
      totalTiers: 4,
      graves: [{ id: 10, tier: 1, deceasedName: "Ramon" }],
    };

    it("reports which tiers are free and who holds the rest", () => {
      const tiers = tierAvailability(crypt);
      expect(tiers).toHaveLength(4);
      expect(tiers[0]).toMatchObject({ tier: 1, occupant: { deceasedName: "Ramon" } });
      expect(tiers.slice(1).every((t) => t.occupant === null)).toBe(true);
      expect(tiers[1].label).toBe("Tier 2 (Second Level)");
    });

    it("frees a grave's own tier while it is being edited", () => {
      expect(tierAvailability(crypt, 10)[0].occupant).toBeNull();
      expect(tierAvailability(crypt, 99)[0].occupant).not.toBeNull();
    });

    it("offers a partly filled building plot even though its status is occupied", () => {
      expect(hasVacantTier(crypt)).toBe(true);
      expect(canAddGrave(crypt)).toBe(true);
    });

    it("does not offer full, reserved, maintenance or missing plots", () => {
      const full = { ...crypt, totalTiers: 1 };
      expect(canAddGrave(full)).toBe(false); // single tier, taken
      expect(canAddGrave({ ...crypt, status: "reserved" })).toBe(false);
      expect(canAddGrave({ ...crypt, status: "maintenance" })).toBe(false);
      expect(canAddGrave(null)).toBe(false);
    });

    it("always offers an available plot", () => {
      expect(canAddGrave({ id: 2, plotNumber: "L-1", status: "available", totalTiers: 1, graves: [] })).toBe(true);
    });
  });

  describe("map status by tier", () => {
    const column = (tiers, status = "occupied") => ({
      status,
      totalTiers: 4,
      graves: tiers.map((tier, i) => ({ id: i + 1, tier })),
    });

    it("counts occupied tiers, bottom first", () => {
      expect(tierOccupancy(column([1, 2]))).toEqual({ occupied: 2, total: 4, tiers: [true, true, false, false] });
    });

    it("marks a partly filled column as partial, and full or empty ones by their status", () => {
      expect(mapPlotStatus(column([1, 2]))).toBe("partial");
      expect(mapPlotStatus(column([1, 2, 3, 4]))).toBe("occupied");
      expect(mapPlotStatus(column([], "available"))).toBe("available");
      expect(mapPlotStatus({ status: "occupied", totalTiers: 1, graves: [{ id: 1, tier: 1 }] })).toBe("occupied");
    });

    it("keeps reserved and maintenance plots as they are", () => {
      expect(mapPlotStatus(column([1], "reserved"))).toBe("reserved");
      expect(mapPlotStatus(column([1], "maintenance"))).toBe("maintenance");
    });

    it("lets the occupied filter include partly filled columns", () => {
      expect(matchesStatusFilter("partial", "occupied")).toBe(true);
      expect(matchesStatusFilter("partial", "partial")).toBe(true);
      expect(matchesStatusFilter("occupied", "partial")).toBe(false);
      expect(matchesStatusFilter("available", "all")).toBe(true);
    });
  });

  describe("tier level names", () => {
    it("names the levels of a 4-tier stack from the ground up", () => {
      expect([1, 2, 3, 4].map((n) => tierLevelName(n, 4))).toEqual([
        "Ground Level",
        "Second Level",
        "Third Level",
        "Top Level",
      ]);
      expect(tierLevelName(1, 1)).toBe("Ground Burial Lot");
      expect(tierLabel(4, 4)).toBe("Tier 4 (Top Level)");
    });
  });
});

describe("status keys on the maps", () => {
  // The statuses a plot can have (prisma/schema.prisma, enum PlotStatus).
  const STATUSES = ["available", "occupied", "reserved", "maintenance"];
  const fs = require("node:fs");
  const read = (f) => fs.readFileSync(f, "utf8");

  it("lists exactly the plot statuses, so every filter button finds plots", () => {
    const schema = read("prisma/schema.prisma");
    const inSchema = /enum PlotStatus \{([^}]*)\}/.exec(schema)[1].trim().split(/\s+/);
    expect(inSchema.sort()).toEqual([...STATUSES].sort());
    // Both maps use the shared key (MapStatusKey).
    const keys = [...read("src/components/map/MapStatusKey.js").matchAll(/\{ key: "([a-z]+)", label: "[^"]+" \}/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...STATUSES].sort());
    for (const file of ["src/components/CemeteryMap.js", "src/components/map3d/CemeteryMap3D.js"]) {
      expect(read(file), file).toMatch(/<MapStatusKey/);
      expect(read(file)).not.toMatch(/"(sold|hold|unavailable)"/);
    }
    expect(read("src/components/plot-picker/PlotPickerModal.js")).not.toMatch(/"(sold|hold)"/);
  });
});

