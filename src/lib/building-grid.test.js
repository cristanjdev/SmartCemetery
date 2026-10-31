import { describe, it, expect } from "vitest";
import {
  localOffsetToLatLng,
  latLngToLocalOffset,
  getBuildingCorners,
  getSubdividedBuildingCells,
  snapBuildingToPlots,
  applyBuildingCellsToPlots,
} from "./building-grid";

describe("building-grid utility", () => {
  const centerLat = 8.4659;
  const centerLng = 124.6570;
  const angleDeg = 37.7;

  it("converts local offsets to lat/lng and back (round-trip)", () => {
    const originalDx = 12.5;
    const originalDy = -3.2;

    const coords = localOffsetToLatLng(originalDx, originalDy, centerLat, centerLng, angleDeg);
    expect(coords.lat).toBeGreaterThan(8.46);
    expect(coords.lng).toBeGreaterThan(124.65);

    const recovered = latLngToLocalOffset(coords.lat, coords.lng, centerLat, centerLng, angleDeg);
    expect(recovered.dx).toBeCloseTo(originalDx, 1);
    expect(recovered.dy).toBeCloseTo(originalDy, 1);
  });

  it("calculates 4 building corners", () => {
    const corners = getBuildingCorners({
      centerLat,
      centerLng,
      lengthMeters: 26.5,
      widthMeters: 2.8,
      angleDeg,
    });

    expect(corners).toHaveLength(4);
    for (const pt of corners) {
      expect(pt.lat).toBeDefined();
      expect(pt.lng).toBeDefined();
    }
  });

  it("subdivides rectangle into requested rows and columns", () => {
    const dummyPlots = [
      { id: 101, plotNumber: "ROW-E02-C01", status: "occupied" },
      { id: 102, plotNumber: "ROW-E02-C02", status: "sold" },
      { id: 103, plotNumber: "ROW-E02-C03", status: "available" },
    ];

    const cells = getSubdividedBuildingCells({
      centerLat,
      centerLng,
      lengthMeters: 9.0,
      widthMeters: 3.0,
      angleDeg,
      numCols: 3,
      numRows: 1,
      invertCols: false,
      targetPlots: dummyPlots,
    });

    expect(cells).toHaveLength(3);
    expect(cells[0].plot.id).toBe(101);
    expect(cells[0].status).toBe("occupied");
    expect(cells[1].plot.id).toBe(102);
    expect(cells[1].status).toBe("sold");
    expect(cells[2].plot.id).toBe(103);
    expect(cells[2].status).toBe("available");

    // All cells have 4 corners and center
    for (const cell of cells) {
      expect(cell.corners).toHaveLength(4);
      expect(cell.center.lat).toBeDefined();
      expect(cell.center.lng).toBeDefined();
    }
  });

  it("supports inverting column order", () => {
    const dummyPlots = [
      { id: 101, plotNumber: "ROW-E02-C01", status: "occupied" },
      { id: 102, plotNumber: "ROW-E02-C02", status: "sold" },
    ];

    const cells = getSubdividedBuildingCells({
      centerLat,
      centerLng,
      lengthMeters: 6.0,
      widthMeters: 3.0,
      angleDeg,
      numCols: 2,
      numRows: 1,
      invertCols: true,
      targetPlots: dummyPlots,
    });

    expect(cells).toHaveLength(2);
    expect(cells[0].plot.id).toBe(101);
    // With invertCols, cell 0 is placed on the opposite end
    expect(cells[0].colIndex).toBe(0);
  });

  it("snaps building footprint to existing plot coordinates", () => {
    const rowPlots = [
      { id: 1, plotNumber: "ROW-E02-C01", gpsLat: 8.4659276, gpsLng: 124.65690451 },
      { id: 2, plotNumber: "ROW-E02-C02", gpsLat: 8.4659400, gpsLng: 124.65692500 },
      { id: 3, plotNumber: "ROW-E02-C03", gpsLat: 8.46604527, gpsLng: 124.65709523 },
    ];

    const snap = snapBuildingToPlots(rowPlots, angleDeg);
    expect(snap).not.toBeNull();
    expect(snap.centerLat).toBeCloseTo(8.46597, 3);
    expect(snap.lengthMeters).toBeGreaterThan(10);
    expect(snap.numCols).toBe(3);
  });

  it("applies cell center coordinates to plots array", () => {
    const dummyPlots = [
      { id: 101, plotNumber: "ROW-E02-C01", gpsLat: 8.0, gpsLng: 124.0 },
      { id: 102, plotNumber: "ROW-E02-C02", gpsLat: 8.0, gpsLng: 124.0 },
      { id: 999, plotNumber: "OTHER-001", gpsLat: 8.1, gpsLng: 124.1 },
    ];

    const cells = getSubdividedBuildingCells({
      centerLat,
      centerLng,
      lengthMeters: 6.0,
      widthMeters: 3.0,
      angleDeg,
      numCols: 2,
      numRows: 1,
      targetPlots: [dummyPlots[0], dummyPlots[1]],
    });

    const updated = applyBuildingCellsToPlots(cells, dummyPlots);
    expect(updated).toHaveLength(3);

    const p101 = updated.find((p) => p.id === 101);
    expect(p101._modified).toBe(true);
    expect(p101.gpsLat).toBeCloseTo(cells[0].center.lat, 6);
    expect(p101.gpsLng).toBeCloseTo(cells[0].center.lng, 6);

    const p999 = updated.find((p) => p.id === 999);
    expect(p999._modified).toBeUndefined();
    expect(p999.gpsLat).toBe(8.1);
  });

  it("gives generated plots their building's tier count and key so they are saved as building plots", () => {
    const existing = [
      { id: 1, plotNumber: "ROW-E03-C01", locationDetailId: 18, totalTiers: 4, locationDetail: { subsection: "ROW-E03" } },
    ];
    const cells = getSubdividedBuildingCells({
      centerLat: 8.4658,
      centerLng: 124.657,
      lengthMeters: 6,
      widthMeters: 3,
      angleDeg: 37.7,
      numCols: 2,
      targetPlots: existing,
      targetRow: "ROW-E03",
    });
    const fresh = cells[1].plot;
    expect(fresh.isNew).toBe(true);
    expect(fresh.plotNumber).toBe("ROW-E03-C02");
    expect(fresh.totalTiers).toBeGreaterThan(1);
    expect(fresh._buildingKey).toBe("ROW-E03");
    expect(fresh.locationDetailId).toBe(18);
  });

  it("derives the row name of a brand-new row from its plots, not from a fixed prefix list", () => {
    const cells = getSubdividedBuildingCells({
      centerLat: 8.4658,
      centerLng: 124.657,
      lengthMeters: 4,
      widthMeters: 3,
      angleDeg: 0,
      numCols: 1,
      targetPlots: [{ id: 5, plotNumber: "Crypt Block 2-C01" }],
      targetRow: "custom",
    });
    expect(cells[0].label).toBe("Crypt Block 2-C01");
    expect(cells[0].plot.id).toBe(5);
  });

  it("detects and preserves rotated angles for building rows", () => {
    // Generate 5 plots along a 25° line
    const testAngle = 25.0;
    const testCenterLat = 8.4658;
    const testCenterLng = 124.6572;
    const rotatedPlots = [];
    for (let i = 0; i < 5; i++) {
      const offset = (i - 2) * 2.5; // -5m, -2.5m, 0m, 2.5m, 5m
      const pos = localOffsetToLatLng(offset, 0, testCenterLat, testCenterLng, testAngle);
      rotatedPlots.push({
        id: i + 1,
        plotNumber: `ROW-TEST-C0${i + 1}`,
        gpsLat: pos.lat,
        gpsLng: pos.lng,
      });
    }

    const snapped = snapBuildingToPlots(rotatedPlots, 37.7);
    expect(snapped).not.toBeNull();
    expect(snapped.angleDeg).toBeCloseTo(25.0, 0);
  });

  it("continues the count and appends new plots when column count exceeds existing plots", () => {
    const existingPlots = [
      { id: 201, plotNumber: "ROW-E03-C01", locationDetailId: 18, totalTiers: 4, locationDetail: { subsection: "ROW-E03" }, gpsLat: 8.46, gpsLng: 124.65 },
      { id: 202, plotNumber: "ROW-E03-C02", locationDetailId: 18, totalTiers: 4, locationDetail: { subsection: "ROW-E03" }, gpsLat: 8.46, gpsLng: 124.65 },
    ];

    // Request 4 columns when only 2 exist
    const cells = getSubdividedBuildingCells({
      centerLat: 8.4658,
      centerLng: 124.6570,
      lengthMeters: 12.0,
      widthMeters: 3.0,
      angleDeg: 37.7,
      numCols: 4,
      numRows: 1,
      targetPlots: existingPlots,
      targetRow: "ROW-E03",
    });

    expect(cells).toHaveLength(4);
    expect(cells[0].label).toBe("ROW-E03-C01");
    expect(cells[1].label).toBe("ROW-E03-C02");
    expect(cells[2].label).toBe("ROW-E03-C03");
    expect(cells[3].label).toBe("ROW-E03-C04");
    expect(cells[2].plot.isNew).toBe(true);
    expect(cells[3].plot.isNew).toBe(true);

    const updated = applyBuildingCellsToPlots(cells, existingPlots);
    expect(updated).toHaveLength(4);
    expect(updated[2].plotNumber).toBe("ROW-E03-C03");
    expect(updated[2]._isNew).toBe(true);
    expect(updated[2]._modified).toBe(true);
    expect(updated[3].plotNumber).toBe("ROW-E03-C04");
    expect(updated[3]._isNew).toBe(true);
    expect(updated[3]._modified).toBe(true);
  });

  it("marks excess plots without graves as _deleted and unpins excess plots with graves when columns are reduced", () => {
    const existingPlots = [
      { id: 201, plotNumber: "ROW-E03-C01", locationDetailId: 18, totalTiers: 4, locationDetail: { subsection: "ROW-E03" }, gpsLat: 8.46, gpsLng: 124.65, graves: [] },
      { id: 202, plotNumber: "ROW-E03-C02", locationDetailId: 18, totalTiers: 4, locationDetail: { subsection: "ROW-E03" }, gpsLat: 8.46, gpsLng: 124.65, graves: [] },
      { id: 203, plotNumber: "ROW-E03-C03", locationDetailId: 18, totalTiers: 4, locationDetail: { subsection: "ROW-E03" }, gpsLat: 8.46, gpsLng: 124.65, graves: [] },
      { id: 204, plotNumber: "ROW-E03-C04", locationDetailId: 18, totalTiers: 4, locationDetail: { subsection: "ROW-E03" }, gpsLat: 8.46, gpsLng: 124.65, graves: [{ id: 99, deceasedName: "Jane Doe" }] },
      { id: 301, plotNumber: "ROW-E04-C01", locationDetailId: 19, totalTiers: 4, locationDetail: { subsection: "ROW-E04" }, gpsLat: 8.461, gpsLng: 124.651, graves: [] },
    ];

    // Reduce ROW-E03 from 4 columns to 2 columns
    const cells = getSubdividedBuildingCells({
      centerLat: 8.4658,
      centerLng: 124.6570,
      lengthMeters: 6.0,
      widthMeters: 3.0,
      angleDeg: 37.7,
      numCols: 2,
      numRows: 1,
      targetPlots: existingPlots.filter((p) => p.plotNumber.startsWith("ROW-E03")),
      targetRow: "ROW-E03",
    });

    expect(cells).toHaveLength(2);
    expect(cells[0].label).toBe("ROW-E03-C01");
    expect(cells[1].label).toBe("ROW-E03-C02");

    const updated = applyBuildingCellsToPlots(cells, existingPlots, "ROW-E03");
    expect(updated).toHaveLength(5);

    // C01 and C02 updated
    expect(updated[0]._modified).toBe(true);
    expect(updated[0]._deleted).toBe(false);
    expect(updated[1]._modified).toBe(true);
    expect(updated[1]._deleted).toBe(false);

    // C03 has no graves -> marked _deleted
    expect(updated[2].id).toBe(203);
    expect(updated[2]._deleted).toBe(true);
    expect(updated[2]._modified).toBe(true);

    // C04 has an active grave -> NOT deleted, unpinned instead
    expect(updated[3].id).toBe(204);
    expect(updated[3]._deleted).toBe(false);
    expect(updated[3].gpsLat).toBeNull();
    expect(updated[3].gpsLng).toBeNull();
    expect(updated[3]._modified).toBe(true);

    // ROW-E04-C01 untouched
    expect(updated[4].id).toBe(301);
    expect(updated[4]._modified).toBeUndefined();
    expect(updated[4]._deleted).toBeUndefined();
  });

  it("deletes an entire building when cells is empty", () => {
    const existingPlots = [
      { id: 101, plotNumber: "ROW-W01-C01", locationDetailId: 10, totalTiers: 4, locationDetail: { subsection: "ROW-W01" }, gpsLat: 8.46, gpsLng: 124.65, graves: [] },
      { id: 102, plotNumber: "ROW-W01-C02", locationDetailId: 10, totalTiers: 4, locationDetail: { subsection: "ROW-W01" }, gpsLat: 8.46, gpsLng: 124.65, graves: [{ id: 1 }] },
      { id: 103, plotNumber: "ROW-W01-C03", locationDetailId: 10, totalTiers: 4, locationDetail: { subsection: "ROW-W01" }, gpsLat: 8.46, gpsLng: 124.65, graves: [] },
      { id: 104, plotNumber: "ROW-W02-C01", locationDetailId: 11, totalTiers: 4, locationDetail: { subsection: "ROW-W02" }, gpsLat: 8.46, gpsLng: 124.65, graves: [] },
    ];

    // Delete entire ROW-W01
    const updated = applyBuildingCellsToPlots([], existingPlots, "ROW-W01");
    expect(updated).toHaveLength(4);

    // Empty plots in ROW-W01 are marked _deleted: true
    expect(updated[0].id).toBe(101);
    expect(updated[0]._deleted).toBe(true);
    expect(updated[0]._modified).toBe(true);

    expect(updated[2].id).toBe(103);
    expect(updated[2]._deleted).toBe(true);
    expect(updated[2]._modified).toBe(true);

    // Occupied plot with grave is unpinned (NOT deleted)
    expect(updated[1].id).toBe(102);
    expect(updated[1]._deleted).toBe(false);
    expect(updated[1].gpsLat).toBeNull();
    expect(updated[1].gpsLng).toBeNull();
    expect(updated[1]._modified).toBe(true);

    // Other rows untouched
    expect(updated[3].id).toBe(104);
    expect(updated[3]._modified).toBeUndefined();
    expect(updated[3]._deleted).toBeUndefined();
  });

  it("never regenerates an existing plot number — it fills numbering gaps instead", () => {
    // Degenerate row with a gap: C01 and C03 exist, C02 is missing.
    const existingPlots = [
      { id: 1, plotNumber: "ROW-E05-C01", locationDetailId: 20 },
      { id: 3, plotNumber: "ROW-E05-C03", locationDetailId: 20 },
    ];

    const cells = getSubdividedBuildingCells({
      centerLat: 8.4658,
      centerLng: 124.6570,
      lengthMeters: 9.0,
      widthMeters: 3.0,
      angleDeg: 37.7,
      numCols: 3,
      numRows: 1,
      targetPlots: existingPlots,
      targetRow: "ROW-E05",
    });

    const labels = cells.map((cell) => cell.label);
    expect(labels).toHaveLength(3);
    // All labels distinct: the old code generated a second "ROW-E05-C03" here,
    // which collapsed two cells onto one plot.
    expect(new Set(labels).size).toBe(3);
    // The gap is filled with the smallest unused number.
    expect(labels).toContain("ROW-E05-C02");

    const updated = applyBuildingCellsToPlots(cells, existingPlots, "ROW-E05");
    expect(updated).toHaveLength(3);
  });
});

describe("back-to-back blocks", () => {
  const center = { lat: 8.4659, lng: 124.657 };
  const angleDeg = 31;
  // Three columns, each with a front (A, dy -1.4) and a back (B, dy +1.4) plot.
  const plots = [1, 2, 3].flatMap((c) =>
    [
      ["A", -1.4],
      ["B", 1.4],
    ].map(([side, dy]) => {
      const pos = localOffsetToLatLng((c - 2) * 2.65, dy, center.lat, center.lng, angleDeg);
      return {
        id: c * 10 + (side === "A" ? 1 : 2),
        plotNumber: `ROW-E02-C0${c}-${side}`,
        totalTiers: 4,
        gpsLat: pos.lat,
        gpsLng: pos.lng,
        locationDetail: { subsection: "ROW-E02" },
      };
    })
  );

  it("snaps to a block two faces wide with one column per position", () => {
    const snapped = snapBuildingToPlots(plots, angleDeg);
    expect(snapped.numRows).toBe(2);
    expect(snapped.numCols).toBe(3);
    expect(snapped.widthMeters).toBeCloseTo(5.6, 6);
  });

  it("puts front plots in row 0 and back plots in row 1, in column order", () => {
    const snapped = snapBuildingToPlots(plots, angleDeg);
    const cells = getSubdividedBuildingCells({ ...snapped, targetPlots: plots, targetRow: "ROW-E02" });
    expect(cells).toHaveLength(6);
    expect(cells.filter((c) => c.rowIndex === 0).map((c) => c.label)).toEqual([
      "ROW-E02-C01-A",
      "ROW-E02-C02-A",
      "ROW-E02-C03-A",
    ]);
    expect(cells.filter((c) => c.rowIndex === 1).map((c) => c.label)).toEqual([
      "ROW-E02-C01-B",
      "ROW-E02-C02-B",
      "ROW-E02-C03-B",
    ]);
    // Each plot's cell lies on its own face (front cells on the -dy side).
    for (const cell of cells) {
      const { dy } = latLngToLocalOffset(cell.center.lat, cell.center.lng, snapped.centerLat, snapped.centerLng, snapped.angleDeg);
      expect(Math.sign(dy)).toBe(cell.rowIndex === 0 ? -1 : 1);
    }
  });

  it("names a missing face plot after its column and face", () => {
    const frontOnly = plots.filter((p) => p.plotNumber !== "ROW-E02-C02-B");
    const snapped = snapBuildingToPlots(plots, angleDeg);
    const cells = getSubdividedBuildingCells({ ...snapped, targetPlots: frontOnly, targetRow: "ROW-E02" });
    expect(cells.map((c) => c.label)).toContain("ROW-E02-C02-B");
  });
});

