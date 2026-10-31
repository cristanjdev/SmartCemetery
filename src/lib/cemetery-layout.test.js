import { describe, it, expect } from "vitest";
import {
  isBuildingPlot,
  getBuildingKey,
  belongsToBuilding,
  compareByColumn,
  listBuildingKeys,
  plotsOfBuilding,
  buildingLabel,
  sectionFromPlotNumber,
  buildingPlotNumber,
  plotSide,
  buildingSideCount,
  columnShortLabel,
  blockFullLabel,
  blockTypeName,
} from "@/lib/cemetery-layout";

const plot = (plotNumber, section, totalTiers = 4, extra = {}) => ({
  plotNumber,
  totalTiers,
  locationDetail: { subsection: section },
  ...extra,
});

describe("cemetery-layout", () => {
  it("recognises buildings by tier count, not by naming or ids", () => {
    expect(isBuildingPlot(plot("X-1", "Wing A", 4))).toBe(true);
    expect(isBuildingPlot(plot("ROW-E01-C01", "ROW-E01", 1))).toBe(false); // name alone proves nothing
    expect(isBuildingPlot({ plotNumber: "A-1" })).toBe(false);
    expect(isBuildingPlot(null)).toBe(false);
  });

  it("takes the building from the plot's section, or _buildingKey for unsaved plots", () => {
    expect(getBuildingKey(plot("Anything-7", "Crypt Block 2"))).toBe("Crypt Block 2");
    expect(getBuildingKey({ plotNumber: "n", totalTiers: 4, _buildingKey: "NEW-ROW" })).toBe("NEW-ROW");
    expect(getBuildingKey(plot("A-1", "Lawn", 1))).toBeNull();
  });

  it("includes an oddly named plot in its row purely from its section (was the WALAG-001 special case)", () => {
    const walag = plot("WALAG-001", "ROW-W07");
    expect(belongsToBuilding(walag, "ROW-W07")).toBe(true);
    expect(belongsToBuilding(walag, "ROW-W06")).toBe(false);
    expect(belongsToBuilding(walag, "custom")).toBe(false);
    expect(belongsToBuilding(walag, null)).toBe(false);
  });

  it("orders columns by trailing number, so WALAG-001 precedes ROW-W07-C02 without an exception", () => {
    const row = [
      plot("ROW-W07-C03", "ROW-W07"),
      plot("WALAG-001", "ROW-W07"),
      plot("ROW-W07-C10", "ROW-W07"),
      plot("ROW-W07-C02", "ROW-W07"),
    ];
    expect([...row].sort(compareByColumn).map((p) => p.plotNumber)).toEqual([
      "WALAG-001",
      "ROW-W07-C02",
      "ROW-W07-C03",
      "ROW-W07-C10",
    ]);
  });

  it("lists distinct building keys in natural order and ignores deleted plots", () => {
    const plots = [
      plot("a", "ROW-E10"),
      plot("b", "ROW-E2"),
      plot("c", "ROW-E2"),
      plot("d", "Lawn", 1),
      plot("e", "ROW-GONE", 4, { _deleted: true }),
    ];
    expect(listBuildingKeys(plots)).toEqual(["ROW-E2", "ROW-E10"]);
  });

  it("selects a building's live plots in column order", () => {
    const plots = [
      plot("R-C02", "R"),
      plot("R-C01", "R"),
      plot("R-C03", "R", 4, { _deleted: true }),
      plot("Z-C01", "Z"),
    ];
    expect(plotsOfBuilding(plots, "R").map((p) => p.plotNumber)).toEqual(["R-C01", "R-C02"]);
  });

  it("labels keys and round-trips generated plot numbers", () => {
    expect(buildingLabel("ROW-E01")).toBe("Row E01");
    expect(buildingLabel("FBN-B21")).toBe("FBN B21");
    expect(blockTypeName("FBN-B21")).toBe("Fresh Body Niche");
    expect(blockTypeName("SBN B7")).toBe("Special Body Niche");
    expect(blockTypeName("BBN-B1")).toBe("Baby Niche");
    expect(blockTypeName("ROW-E01")).toBeNull();
    expect(blockFullLabel("BBN-B2")).toBe("BBN B2 · Baby Niche");
    expect(blockFullLabel("A1")).toBe("A1");
    expect(buildingLabel("Crypt Block 2")).toBe("Crypt Block 2");
    expect(buildingLabel(null)).toBe("");
    const n = buildingPlotNumber("ROW-E01", 7);
    expect(n).toBe("ROW-E01-C07");
    expect(sectionFromPlotNumber(n)).toBe("ROW-E01");
    expect(sectionFromPlotNumber("Plot 4")).toBe("Plot 4");
  });
});

describe("back-to-back blocks", () => {
  it("reads the face letter of a plot number", () => {
    expect(plotSide("ROW-E02-C09-A")).toBe("A");
    expect(plotSide({ plotNumber: "ROW-E02-C09-b" })).toBe("B");
    expect(plotSide("ROW-E02-C09")).toBeNull();
    expect(plotSide("SECTION-A")).toBeNull();
  });

  it("counts two faces once any plot carries a side letter", () => {
    expect(buildingSideCount([plot("ROW-E02-C01", "ROW-E02")])).toBe(1);
    expect(buildingSideCount([plot("ROW-E02-C01-A", "ROW-E02"), plot("ROW-E02-C01-B", "ROW-E02")])).toBe(2);
  });

  it("orders by column, front before back", () => {
    const sorted = ["ROW-E02-C02-B", "ROW-E02-C10-A", "ROW-E02-C02-A", "ROW-E02-C01-B"]
      .map((n) => plot(n, "ROW-E02"))
      .sort(compareByColumn)
      .map((p) => p.plotNumber);
    expect(sorted).toEqual(["ROW-E02-C01-B", "ROW-E02-C02-A", "ROW-E02-C02-B", "ROW-E02-C10-A"]);
  });

  it("names, labels and sections plots with a face letter", () => {
    expect(buildingPlotNumber("ROW-E02", 9, "B")).toBe("ROW-E02-C09-B");
    expect(buildingPlotNumber("ROW-E02", 9)).toBe("ROW-E02-C09");
    expect(columnShortLabel("ROW-E02-C09-B")).toBe("9B");
    expect(columnShortLabel("ROW-E02-C09")).toBe("9");
    expect(sectionFromPlotNumber("ROW-E02-C09-A")).toBe("ROW-E02");
  });
});
