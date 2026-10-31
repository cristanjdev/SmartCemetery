import { describe, it, expect } from "vitest";
import { END_SNAP_M, fitRowLines, regularizeBlocks, snapClusters } from "./block-grid";
import { buildSceneLayout } from "./scene-layout";
import { TRACED_ROW_KEYS, placeUnmappedBlocks } from "./site-surroundings";
import { LAYOUT_PRESET } from "./layout-preset";

describe("block grid", () => {
  it("puts nearly equal values on one value and leaves far ones alone", () => {
    const out = snapClusters([10, 11.5, 30, 12, 31]);
    expect(out[0]).toBeCloseTo(11.1667, 3);
    expect(out[1]).toBe(out[0]);
    expect(out[3]).toBe(out[0]);
    expect(out[2]).toBeCloseTo(30.5, 6);
    expect(out[4]).toBe(out[2]);
  });

  it("fits the row-line spacing and offset", () => {
    const { spacing, offset } = fitRowLines([0.4, 10.6, 21.0, 31.2, -10.1]);
    expect(spacing).toBeGreaterThan(10);
    expect(spacing).toBeLessThan(10.6);
    expect(Math.abs(offset)).toBeLessThan(1);
  });

  it("makes every block parallel, on even row lines, with plots spread along each block", () => {
    const layout = buildSceneLayout({ preset: LAYOUT_PRESET });
    const drawn = placeUnmappedBlocks(layout.ref, layout.blocks);
    const { mapped, drawn: tidyDrawn } = regularizeBlocks(layout.blocks, drawn);
    const all = [...mapped, ...tidyDrawn];
    const angle = all[0].rotationY;
    for (const b of all) expect(b.rotationY).toBe(angle);

    // Across positions sit on multiples of one spacing.
    const across = (p) => p.x * Math.sin(angle) + p.z * Math.cos(angle);
    const vs = all.map((b) => across(b.center));
    const { spacing } = fitRowLines(mapped.map((b) => across(b.center)));
    const base = vs[0];
    for (const v of vs) {
      const k = (v - base) / spacing;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }

    // Each mapped row keeps all its plots, evenly spaced inside the block.
    for (const [i, b] of mapped.entries()) {
      expect(b.cells).toHaveLength(layout.blocks[i].cells.length);
      // Each face holds one plot per column.
      const perFace = b.cells.length / (b.faces || 1);
      for (const cell of b.cells) expect(cell.length).toBeCloseTo(b.length / perFace, 9);
    }
  });

  it("fits the grid to the surveyed rows, so rows traced from the photo do not skew it", () => {
    const layout = buildSceneLayout({ preset: LAYOUT_PRESET });
    const surveyed = layout.blocks.filter((b) => !TRACED_ROW_KEYS.has(b.key));
    const traced = layout.blocks.filter((b) => TRACED_ROW_KEYS.has(b.key));
    expect(traced.length).toBeGreaterThan(0);
    const all = regularizeBlocks(layout.blocks, [], { isReference: (b) => !TRACED_ROW_KEYS.has(b.key) });
    const surveyedOnly = regularizeBlocks(surveyed, []);
    // Same angle as the surveyed rows alone, and they stay on their row lines
    // (ends close to a traced block's end may still be lined up with it).
    expect(all.mapped[0].rotationY).toBeCloseTo(surveyedOnly.mapped[0].rotationY, 6);
    for (const b of surveyedOnly.mapped) {
      const same = all.mapped.find((m) => m.key === b.key);
      expect(Math.hypot(same.center.x - b.center.x, same.center.z - b.center.z)).toBeLessThan(END_SNAP_M);
    }
  });

  it("puts traced rows on the same even row lines as the surveyed ones", () => {
    const layout = buildSceneLayout({ preset: LAYOUT_PRESET });
    const { mapped } = regularizeBlocks(layout.blocks, [], { isReference: (b) => !TRACED_ROW_KEYS.has(b.key) });
    const theta = mapped[0].rotationY;
    const v = mapped.map((b) => b.center.x * Math.sin(theta) + b.center.z * Math.cos(theta));
    const lines = [...new Set(v.map((x) => x.toFixed(2)))].map(Number).sort((a, b) => a - b);
    const steps = lines.slice(1).map((x, i) => x - lines[i]);
    for (const step of steps) expect(step).toBeCloseTo(steps[0], 1);
  });

  it("leaves an empty layout alone", () => {
    expect(regularizeBlocks([], [])).toEqual({ mapped: [], drawn: [] });
  });
});
