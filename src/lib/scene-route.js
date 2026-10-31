/**
 * The walking route as the 3D map draws it (pure).
 *
 * The 3D map lines its blocks up for display (block-grid.js), so a route
 * planned on their real (GPS) positions can cut across a drawn block. This
 * plans the walk again, the same way (walkways.js), round the blocks and
 * buildings as they are drawn: same start, ending in the aisle on the plot's
 * own face. Coordinates are scene metres ({ x: east, z: south }) around `ref`.
 */
import { toLatLng, toLocal } from "./scene-layout";
import { buildWalkwayNetwork, findWalkingRoute } from "./walkways";
import { siteBoundaryPath } from "./site-overlay";

/**
 * @param {{ ref: {lat:number,lng:number}, start: {x:number,z:number}, plot: {x:number,z:number},
 *           blocks: Array<{ key: string, center: {x:number,z:number}, rotationY: number, length: number, width: number }>,
 *           buildings?: Array<{ label: string, x: number, z: number, angleDeg?: number, length: number, width: number }> }} input
 * @returns {Array<{x:number,z:number}> | null} null when no walk is found
 */
export function sceneWalk({ ref, start, plot, blocks, buildings = [] }) {
  if (!ref || !start || !plot || !blocks?.length) return null;
  const rect = (key, center, angleDeg, length, width) => ({ key, center: toLatLng(ref, center), angleDeg, length, width });
  const obstacles = [
    ...blocks.map((b) => rect(b.key, b.center, (b.rotationY * 180) / Math.PI, b.length, b.width)),
    ...buildings.map((b) => rect(b.label, { x: b.x, z: b.z }, b.angleDeg || 0, b.length, b.width)),
  ];
  const from = toLatLng(ref, start);
  const network = buildWalkwayNetwork([{ key: "start", ...from }], obstacles, siteBoundaryPath());
  const walk = findWalkingRoute(network, from, toLatLng(ref, plot));
  if (!walk || walk.path.length < 1) return null;
  return [start, ...walk.path.map((p) => toLocal(ref, p))];
}
