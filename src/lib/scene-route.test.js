import { describe, it, expect } from "vitest";
import { sceneWalk } from "./scene-route";
import { buildSceneLayout, toLocal } from "./scene-layout";
import { LAYOUT_PRESET } from "./layout-preset";
import { placeSurroundings, placeUnmappedBlocks, siteYard, TRACED_ROW_KEYS } from "./site-surroundings";
import { regularizeBlocks } from "./block-grid";
import { KIOSK_START_POINT } from "./config";

// The 3D map's own layout: the preset, lined up for display.
const layout = buildSceneLayout({ preset: LAYOUT_PRESET });
const tidy = regularizeBlocks(layout.blocks, placeUnmappedBlocks(layout.ref, layout.blocks), {
  isReference: (b) => !TRACED_ROW_KEYS.has(b.key),
});
const { buildings } = placeSurroundings({ ref: layout.ref, paving: siteYard(layout.ref) });
const start = toLocal(layout.ref, KIOSK_START_POINT);

/** True when segment a→b passes through the (slightly shrunk) block. */
function crosses(block, a, b) {
  const ux = Math.cos(block.rotationY);
  const uz = -Math.sin(block.rotationY);
  const hl = block.length / 2 - 0.3;
  const hw = block.width / 2 - 0.3;
  for (let t = 0; t <= 1; t += 0.01) {
    const px = a.x + (b.x - a.x) * t - block.center.x;
    const pz = a.z + (b.z - a.z) * t - block.center.z;
    if (Math.abs(px * ux + pz * uz) < hl && Math.abs(px * -uz + pz * ux) < hw) return true;
  }
  return false;
}

describe("route as drawn on the 3D map", () => {
  const cases = tidy.mapped.flatMap((b) => [b.cells[0], b.cells.at(-1)].map((cell) => ({ block: b, cell })));

  it("never crosses a drawn block, and ends beside the plot", () => {
    let found = 0;
    for (const { cell } of cases) {
      const path = sceneWalk({ ref: layout.ref, start, plot: cell.center, blocks: tidy.mapped, buildings });
      if (!path) continue;
      found += 1;
      for (let i = 1; i < path.length; i += 1) {
        for (const block of tidy.mapped) {
          expect(crosses(block, path[i - 1], path[i]), `${cell.label} via ${block.key}`).toBe(false);
        }
      }
      const end = path.at(-1);
      expect(Math.hypot(end.x - cell.center.x, end.z - cell.center.z), cell.label).toBeLessThan(6);
    }
    expect(found).toBe(cases.length);
  });
});
