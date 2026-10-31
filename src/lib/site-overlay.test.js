import { describe, expect, it } from "vitest";
import { plotsOutsideBoundary, siteBoundaryOffsets, siteBoundaryPath, siteOverlay } from "./site-overlay";
import { UNMAPPED_BLOCKS, SURROUNDINGS, placeUnmappedBlocks } from "./site-surroundings";
import { buildSceneLayout } from "./scene-layout";
import { LAYOUT_PRESET } from "./layout-preset";

/** Only the ROW-E…/ROW-W… rows, so some directory blocks are still unmapped. */
// The 10 blocks that were only drawn from the photo until their plots were added.
const DIRECTORY_ONLY = ["SBN-B7", "BBN-B1", "FBN-B21", "FBN-B23", "FBN-B22", "FBN-B24", "BBN-B2", "FBN-B13", "SBN-B14", "SBN-B15"];
const ROWS_ONLY = {
  ...LAYOUT_PRESET,
  rows: Object.fromEntries(Object.entries(LAYOUT_PRESET.rows).filter(([k]) => !DIRECTORY_ONLY.includes(k))),
  rowConfigs: Object.fromEntries(Object.entries(LAYOUT_PRESET.rowConfigs).filter(([k]) => !DIRECTORY_ONLY.includes(k))),
};

describe("site overlay for the 2D map", () => {
  it("has no separate blocks once every directory block is a row", () => {
    expect(siteOverlay({ plots: [] }).blocks).toEqual([]);
  });

  it("shows the same unmapped blocks as the 3D map, plus the buildings", () => {
    const { blocks, buildings } = siteOverlay({ plots: [], preset: ROWS_ONLY });
    const layout = buildSceneLayout({ plots: [], preset: ROWS_ONLY });
    const in3d = placeUnmappedBlocks(layout.ref, layout.blocks).map((b) => b.name);
    expect(blocks.map((b) => b.name)).toEqual(in3d);
    expect(blocks.length).toBeGreaterThan(0);
    expect(buildings.map((b) => b.name)).toEqual(SURROUNDINGS.buildings.map((b) => b.label));
  });

  it("gives each shape four GPS corners near the cemetery and an upright label angle", () => {
    const { blocks, buildings } = siteOverlay({ plots: [], preset: ROWS_ONLY });
    for (const shape of [...blocks, ...buildings]) {
      expect(shape.path).toHaveLength(4);
      for (const p of shape.path) {
        expect(p.lat).toBeCloseTo(8.4657, 2);
        expect(p.lng).toBeCloseTo(124.657, 2);
      }
      expect(shape.angleDeg).toBeGreaterThan(-90.01);
      expect(shape.angleDeg).toBeLessThanOrEqual(90);
    }
  });

  it("knows every directory block by name", () => {
    const names = new Set(UNMAPPED_BLOCKS.map((b) => b.name));
    for (const b of siteOverlay({ plots: [], preset: ROWS_ONLY }).blocks) expect(names.has(b.name)).toBe(true);
  });

  describe("cemetery boundary for the 2D map", () => {
    const plots = Object.values(LAYOUT_PRESET.rows).flatMap((r) =>
      r.plots.map((p) => ({ plotNumber: p.plotNumber, gpsLat: p.lat, gpsLng: p.lng, totalTiers: 4 }))
    );

    it("follows the yard outline, a little outside it, and goes round the buildings on its edge", () => {
      const path = siteBoundaryPath();
      expect(path.length).toBeGreaterThan(SURROUNDINGS.yard.length);
      // No edge of the outline crosses another.
      const cross = (a, b, c, d) => {
        const o = (p, q, r) => (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
        return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
      };
      for (let i = 0; i < path.length; i++) {
        for (let j = i + 2; j < path.length; j++) {
          if (i === 0 && j === path.length - 1) continue;
          expect(cross(path[i], path[(i + 1) % path.length], path[j], path[(j + 1) % path.length])).toBe(false);
        }
      }
    });

    it("fits every plot of the layout", () => {
      expect(plotsOutsideBoundary(siteBoundaryOffsets(plots), plots)).toEqual([]);
    });

    it("spots a saved boundary drawn before the newer rows were mapped", () => {
      // The boundary an Admin saved around the first 12 rows.
      const old = [
        { dx: -44.9, dy: 43 }, { dx: 60.6, dy: 35.9 }, { dx: 48.8, dy: -0.3 }, { dx: 43.4, dy: -27.2 },
        { dx: 34.4, dy: -50 }, { dx: 13.9, dy: -51.2 }, { dx: -22.8, dy: -45.9 }, { dx: -50.8, dy: -20.6 },
      ];
      expect(plotsOutsideBoundary(old, plots).length).toBeGreaterThan(0);
    });
  });
});
