import { describe, it, expect } from "vitest";
import {
  LAYOUT_PRESET,
  LAYOUT_ROW_CONFIGS,
  LAYOUT_DELETED_ROWS,
  LAYOUT_PRESET_SUMMARY,
  applyLayoutPreset,
  defaultRowConfig,
  presetTiers,
  summarizePreset,
} from "./layout-preset";

// A tiny self-contained preset so these tests do not depend on any one site's data.
const tiny = {
  name: "Tiny",
  tiersPerPlot: 3,
  deletedRows: ["R-OLD"],
  rows: {
    "R-A": {
      plots: [
        { plotNumber: "R-A-C01", lat: 1.1, lng: 2.1, status: "occupied" },
        { plotNumber: "R-A-C02", lat: 1.2, lng: 2.2 },
      ],
    },
    "R-B": { plots: [{ plotNumber: "ODD-1", lat: 1.3, lng: 2.3 }] },
  },
};

describe("layout-preset (shipped data)", () => {
  it("summarises itself from the data, not from fixed numbers", () => {
    let count = 0;
    for (const row of Object.values(LAYOUT_PRESET.rows)) count += row.plots.length;
    expect(LAYOUT_PRESET_SUMMARY.totalPlots).toBe(count);
    expect(LAYOUT_PRESET_SUMMARY.rowCount).toBe(Object.keys(LAYOUT_PRESET.rows).length);
    expect(LAYOUT_PRESET_SUMMARY.totalPlots).toBeGreaterThan(0);
  });

  it("has a consistent building config for every row", () => {
    for (const [key, row] of Object.entries(LAYOUT_PRESET.rows)) {
      const cfg = LAYOUT_ROW_CONFIGS[key];
      expect(cfg, `config for ${key}`).toBeDefined();
      // One plot per column per face (two faces on a back-to-back block).
      expect(cfg.numCols * (cfg.numRows || 1)).toBe(row.plotCount);
      expect(cfg.lengthMeters).toBeGreaterThan(0);
      expect(Number.isFinite(cfg.angleDeg)).toBe(true);
    }
    expect(defaultRowConfig()).toBe(Object.values(LAYOUT_ROW_CONFIGS)[0]);
  });

  it("identifies its location and retired rows as data", () => {
    expect(LAYOUT_PRESET.location.name).toBeTruthy();
    expect(LAYOUT_PRESET.location.matchName).toBeTruthy();
    expect(Array.isArray(LAYOUT_DELETED_ROWS)).toBe(true);
    for (const r of LAYOUT_DELETED_ROWS) expect(LAYOUT_PRESET.rows[r]).toBeUndefined();
  });
});

describe("applyLayoutPreset", () => {
  it("reads tier count from the preset, else the configured default", () => {
    expect(presetTiers(tiny)).toBe(3);
    expect(presetTiers({})).toBeGreaterThan(1);
  });

  it("summarises an arbitrary preset", () => {
    expect(summarizePreset(tiny)).toEqual({ name: "Tiny", rowCount: 2, totalPlots: 3 });
  });

  it("repositions matching plots, whatever their names look like", () => {
    const result = applyLayoutPreset(
      [
        { id: 1, plotNumber: "R-A-C01", gpsLat: 0, gpsLng: 0 },
        { id: 2, plotNumber: "ODD-1", gpsLat: 0, gpsLng: 0 },
      ],
      tiny
    );
    const a = result.find((p) => p.plotNumber === "R-A-C01");
    expect(a).toMatchObject({ gpsLat: 1.1, gpsLng: 2.1, _modified: true, _deleted: false });
    const odd = result.find((p) => p.plotNumber === "ODD-1");
    expect(odd).toMatchObject({ gpsLat: 1.3, gpsLng: 2.3, _modified: true });
  });

  it("adds missing preset plots as new building plots carrying their row and tiers", () => {
    const result = applyLayoutPreset([], tiny);
    expect(result).toHaveLength(3);
    const created = result.find((p) => p.plotNumber === "R-A-C01");
    expect(created).toMatchObject({
      _isNew: true,
      status: "occupied",
      totalTiers: 3,
      _buildingKey: "R-A",
    });
    expect(result.find((p) => p.plotNumber === "ODD-1")._buildingKey).toBe("R-B");
  });

  it("retires a row by its section: unpins occupied plots, deletes empty ones", () => {
    const result = applyLayoutPreset(
      [
        { id: "occ", plotNumber: "R-OLD-C02", totalTiers: 3, locationDetail: { subsection: "R-OLD" }, gpsLat: 5, gpsLng: 5, graves: [{ id: "g" }] },
        { id: "empty", plotNumber: "R-OLD-C01", totalTiers: 3, locationDetail: { subsection: "R-OLD" }, gpsLat: 5, gpsLng: 5, graves: [] },
        // not in a retired row: untouched even though its number looks similar
        { id: "keep", plotNumber: "R-OLDER-C01", locationDetail: { subsection: "R-OLDER" }, gpsLat: 5, gpsLng: 5 },
      ],
      tiny
    );
    const occ = result.find((p) => p.id === "occ");
    expect(occ).toMatchObject({ gpsLat: null, gpsLng: null, _modified: true, _deleted: false });
    expect(result.find((p) => p.id === "empty")).toMatchObject({ _deleted: true, _modified: true });
    expect(result.find((p) => p.id === "keep")).toMatchObject({ gpsLat: 5, gpsLng: 5 });
    expect(result.find((p) => p.id === "keep")._modified).toBeUndefined();
  });

  it("falls back to the plot number when a plot has no section loaded", () => {
    const result = applyLayoutPreset([{ id: "x", plotNumber: "R-OLD-C09", graves: [] }], tiny);
    expect(result.find((p) => p.id === "x")._deleted).toBe(true);
  });
});
