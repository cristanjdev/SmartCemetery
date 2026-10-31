import { describe, it, expect } from "vitest";
import {
  placeSurroundings,
  placeUnmappedBlocks,
  rectsOverlap,
  siteToScene,
  SITE_ORIGIN,
  SURROUNDINGS,
  UNMAPPED_BLOCKS,
} from "./site-surroundings";
import { buildSceneLayout } from "./scene-layout";
import { LAYOUT_PRESET } from "./layout-preset";

/** The layout before the directory blocks were mapped: only the ROW-E…/ROW-W… rows. */
// The 10 blocks that were only drawn from the photo until their plots were added.
const DIRECTORY_ONLY = ["SBN-B7", "BBN-B1", "FBN-B21", "FBN-B23", "FBN-B22", "FBN-B24", "BBN-B2", "FBN-B13", "SBN-B14", "SBN-B15"];
const ROWS_ONLY = {
  ...LAYOUT_PRESET,
  rows: Object.fromEntries(Object.entries(LAYOUT_PRESET.rows).filter(([k]) => !DIRECTORY_ONLY.includes(k))),
  rowConfigs: Object.fromEntries(Object.entries(LAYOUT_PRESET.rowConfigs).filter(([k]) => !DIRECTORY_ONLY.includes(k))),
};

const PAVING = [
  { x: -45, z: -42 },
  { x: 60, z: -42 },
  { x: 60, z: 45 },
  { x: -45, z: 45 },
];

describe("site surroundings", () => {
  it("leaves points unchanged when the scene is centred on the site origin", () => {
    const p = siteToScene(SITE_ORIGIN, [10, -20]);
    expect(p.x).toBeCloseTo(10, 6);
    expect(p.z).toBeCloseTo(-20, 6);
  });

  it("is the same on every call", () => {
    const a = placeSurroundings({ ref: SITE_ORIGIN, paving: PAVING });
    const b = placeSurroundings({ ref: SITE_ORIGIN, paving: PAVING });
    expect(a.trees.length).toBe(b.trees.length);
    expect(a.trees[0]).toEqual(b.trees[0]);
  });

  it("keeps trees and houses off the paved area, the buildings and clear spots", () => {
    const clear = [{ x: 48, z: -36, r: 10 }];
    const { trees, houses } = placeSurroundings({ ref: SITE_ORIGIN, paving: PAVING, clear });
    expect(trees.length).toBeGreaterThan(100);
    expect(houses.length).toBeGreaterThan(10);
    const inPaving = (p) => p.x > -45 && p.x < 60 && p.z > -42 && p.z < 45;
    expect(trees.some(inPaving)).toBe(false);
    expect(houses.some(inPaving)).toBe(false);
    expect(trees.some((t) => Math.hypot(t.x - 48, t.z + 36) < 10)).toBe(false);
    const commercial = SURROUNDINGS.buildings[0];
    expect(trees.some((t) => Math.hypot(t.x - commercial.x, t.z - commercial.z) < 3)).toBe(false);
  });

  it("keeps every tree canopy off the paved yard", () => {
    const { trees } = placeSurroundings({ ref: SITE_ORIGIN, paving: PAVING });
    const edge = (p) =>
      Math.min(
        ...PAVING.map((a, i) => {
          const b = PAVING[(i + 1) % PAVING.length];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
          return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
        })
      );
    for (const tree of trees) expect(edge(tree)).toBeGreaterThan(tree.r);
  });

  it("detects overlapping and separate rotated rectangles", () => {
    const a = { x: 0, z: 0, length: 10, width: 4, angleDeg: 30 };
    expect(rectsOverlap(a, { ...a, x: 3 })).toBe(true);
    expect(rectsOverlap(a, { ...a, x: 30 })).toBe(false);
  });

  it("is a mapped row for every directory block now, so none is drawn on its own", () => {
    const layout = buildSceneLayout({ preset: LAYOUT_PRESET });
    expect(placeUnmappedBlocks(layout.ref, layout.blocks)).toEqual([]);
  });

  it("draws the directory blocks beside the mapped rows without overlapping them or each other", () => {
    const layout = buildSceneLayout({ preset: ROWS_ONLY });
    const drawn = placeUnmappedBlocks(layout.ref, layout.blocks);
    // ROW-W01/W02/W04 are FBN B20/B19/B16, so those three are rows already.
    expect(drawn.map((b) => b.name).sort()).toEqual(
      UNMAPPED_BLOCKS.map((b) => b.name)
        .filter((n) => !["FBN B16", "FBN B19", "FBN B20"].includes(n))
        .sort()
    );
    const asRect = (b) => ({
      x: b.center.x,
      z: b.center.z,
      length: b.length,
      width: b.width,
      angleDeg: (b.rotationY * 180) / Math.PI,
    });
    for (const d of drawn) {
      expect(layout.blocks.some((m) => rectsOverlap(asRect(m), asRect(d)))).toBe(false);
      expect(drawn.some((o) => o !== d && rectsOverlap(asRect(o), asRect(d)))).toBe(false);
    }
  });

  it("leaves out a drawn block once a mapped row covers its spot", () => {
    const layout = buildSceneLayout({ preset: ROWS_ONLY });
    const [first] = placeUnmappedBlocks(layout.ref, []);
    const covering = { center: first.center, length: first.length, width: first.width, rotationY: first.rotationY };
    const drawn = placeUnmappedBlocks(layout.ref, [covering]);
    expect(drawn.some((d) => d.name === first.name)).toBe(false);
  });
});
