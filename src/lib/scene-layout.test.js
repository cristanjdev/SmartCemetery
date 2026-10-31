import { describe, it, expect } from "vitest";
import { buildSceneLayout, toLocal, toLatLng, hull2d } from "./scene-layout";
import { LAYOUT_PRESET } from "./layout-preset";

describe("scene layout", () => {
  it("round-trips GPS through the local frame", () => {
    const ref = { lat: 8.4657, lng: 124.657 };
    const p = { lat: 8.4659, lng: 124.6573 };
    const back = toLatLng(ref, toLocal(ref, p));
    expect(back.lat).toBeCloseTo(p.lat, 9);
    expect(back.lng).toBeCloseTo(p.lng, 9);
    // North is -z, east is +x.
    expect(toLocal(ref, p).z).toBeLessThan(0);
    expect(toLocal(ref, p).x).toBeGreaterThan(0);
  });

  it("hulls a square with an inside point to its 4 corners", () => {
    const pts = [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }, { x: 0.5, z: 0.5 },
    ];
    expect(hull2d(pts)).toHaveLength(4);
  });

  it("builds every preset row with its plot cells when no plots are loaded", () => {
    const layout = buildSceneLayout({ preset: LAYOUT_PRESET });
    const presetRows = Object.keys(LAYOUT_PRESET.rowConfigs).filter(
      (k) => !LAYOUT_PRESET.deletedRows.includes(k)
    );
    expect(layout.blocks.map((b) => b.key).sort()).toEqual(presetRows.sort());
    const b6 = layout.blocks.find((b) => b.key === "FBN-B6");
    const b6Cfg = LAYOUT_PRESET.rowConfigs["FBN-B6"];
    expect(b6.cells).toHaveLength(b6Cfg.numCols * (b6Cfg.numRows || 1));
    expect(b6.label).toBe("FBN B6");
    expect(layout.footprint.length).toBeGreaterThanOrEqual(3);
  });

  it("swaps in a searched database plot without moving its row", () => {
    const presetOnly = buildSceneLayout({ preset: LAYOUT_PRESET });
    const db = {
      id: 42,
      plotNumber: "FBN-B5-C10-A",
      status: "occupied",
      totalTiers: 4,
      gpsLat: 8.46603734,
      gpsLng: 124.65709235,
      locationDetail: { subsection: "FBN-B5" },
    };
    const layout = buildSceneLayout({ plots: [db], preset: LAYOUT_PRESET });
    const row = layout.blocks.find((b) => b.key === "FBN-B5");
    const before = presetOnly.blocks.find((b) => b.key === "FBN-B5");
    expect(row.length).toBe(before.length);
    expect(row.cells.some((c) => c.plot?.id === 42)).toBe(true);
  });

  it("returns an empty layout when there is nothing to draw", () => {
    expect(buildSceneLayout({}).blocks).toEqual([]);
  });
});
