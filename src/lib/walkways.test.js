import { describe, expect, it } from "vitest";
import { formatRouteSteps } from "@/lib/navigation";
import { buildWalkwayNetwork, findWalkingRoute, isOnSite } from "@/lib/walkways";

const REF = { lat: 8.4658, lng: 124.657 };
const LNG_M = 111320 * Math.cos((REF.lat * Math.PI) / 180);
const at = (x, y) => ({ lat: REF.lat + y / 110574, lng: REF.lng + x / LNG_M });
const local = ({ lat, lng }) => ({ x: (lng - REF.lng) * LNG_M, y: (lat - REF.lat) * 110574 });

// Two east-west rows of 15 plots, 10 m apart: row A at y = 0, row B at y = -10.
function row(key, y) {
  return Array.from({ length: 15 }, (_, i) => ({ key, ...at(-18.55 + i * 2.65, y) }));
}
const network = buildWalkwayNetwork([...row("A", 0), ...row("B", -10)]);

function insideAnyBlock(point) {
  const p = local(point);
  const ref = local(network.ref);
  return network.blocks.some((block) => {
    const d = { x: p.x - ref.x - block.center.x, y: p.y - ref.y - block.center.y };
    return (
      Math.abs(d.x * block.u.x + d.y * block.u.y) < block.halfLength - 0.01 &&
      Math.abs(d.x * block.v.x + d.y * block.v.y) < block.halfWidth - 0.01
    );
  });
}

describe("walkways", () => {
  it("turns each row with two or more plots into a block along the row", () => {
    const withLoner = buildWalkwayNetwork([...row("A", 0), { key: "LONE", ...at(40, 40) }]);
    expect(withLoner.blocks).toHaveLength(1);
    const [block] = withLoner.blocks;
    expect(Math.abs(block.u.x)).toBeCloseTo(1, 3);
    expect(block.halfLength).toBeGreaterThan(18.55);
  });

  it("walks around a row instead of through it", () => {
    const origin = at(0, -20); // south of row B
    const plot = at(0, 0); // middle of row A
    const route = findWalkingRoute(network, origin, plot);
    expect(route).not.toBeNull();

    const points = [origin, ...route.path];
    for (let i = 1; i < points.length; i += 1) {
      for (let t = 0; t <= 1; t += 0.02) {
        const sample = {
          lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
          lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * t,
        };
        expect(insideAnyBlock(sample)).toBe(false);
      }
    }
    // A detour around the end of row B, far longer than the 20 m straight line.
    expect(route.distance).toBeGreaterThan(40);
    // Ends in the aisle beside the plot, not on it.
    const end = local(route.path[route.path.length - 1]);
    expect(Math.abs(end.x)).toBeLessThan(0.5);
    expect(end.y).toBeLessThan(-2);
    expect(end.y).toBeGreaterThan(-8);
  });

  it("ends on the plot's own face of a back-to-back row, even when the other aisle is closer", () => {
    // Row C runs east-west at y = 40: front plots 1.4 m south of its line, back plots 1.4 m north.
    const faces = buildWalkwayNetwork([...row("C", 40 - 1.4), ...row("C", 40 + 1.4)]);
    const origin = at(0, 60); // north of the row, beside the back aisle
    const front = local(findWalkingRoute(faces, origin, at(0, 40 - 1.4)).path.at(-1));
    expect(front.y).toBeLessThan(40 - 1.4 - 2); // south (front) aisle, walking around the row
    const back = local(findWalkingRoute(faces, origin, at(0, 40 + 1.4)).path.at(-1));
    expect(back.y).toBeGreaterThan(40 + 1.4 + 2); // north (back) aisle
  });

  it("walks round a building that has no plots, and ignores one that overlaps a row", () => {
    const building = { key: "Admin Building", center: at(0, 30), angleDeg: 0, length: 12, width: 10 };
    const overlapping = { key: "Old", center: at(0, 0), angleDeg: 0, length: 6, width: 6 };
    const withBuilding = buildWalkwayNetwork([...row("A", 0)], [building, overlapping]);
    expect(withBuilding.blocks.map((b) => b.key)).toEqual(["A", "Admin Building"]);
    // Straight north would cross the building; the walk bends round it.
    const route = findWalkingRoute(withBuilding, at(0, 50), at(0, 15));
    const points = [at(0, 50), ...route.path].map(local);
    for (let i = 1; i < points.length; i += 1) {
      for (let t = 0; t <= 1; t += 0.02) {
        const x = points[i - 1].x + (points[i].x - points[i - 1].x) * t;
        const y = points[i - 1].y + (points[i].y - points[i - 1].y) * t;
        expect(Math.abs(x) < 6 && Math.abs(y - 30) < 5).toBe(false);
      }
    }
  });

  it("stays inside the outer wall, leaving it only at the gate where the walk starts", () => {
    // A wall round rows A and B with the gate at the north-east corner; the start is just inside it.
    const wall = [at(-30, 12), at(30, 12), at(30, -22), at(-30, -22)];
    const walled = buildWalkwayNetwork([...row("A", 0), ...row("B", -10)], [], wall);
    expect(walled.walls).toHaveLength(4);
    const origin = at(26, 8);
    const route = findWalkingRoute(walled, origin, at(-10, -10));
    const points = [origin, ...route.path].map(local);
    for (const p of points) {
      expect(p.x).toBeGreaterThan(-30.01);
      expect(p.x).toBeLessThan(30.01);
      expect(p.y).toBeGreaterThan(-22.01);
      expect(p.y).toBeLessThan(12.01);
    }
    // With no way through inside the wall, it still finds a walk round the blocks.
    const tight = buildWalkwayNetwork([...row("A", 0)], [], [at(-1, 1), at(1, 1), at(1, -1), at(-1, -1)]);
    expect(findWalkingRoute(tight, at(0, 30), at(0, 0))).not.toBeNull();
  });

  it("goes straight when nothing is in the way", () => {
    const route = findWalkingRoute(network, at(-40, 0), at(-40, 20));
    expect(route.path).toHaveLength(2);
    expect(route.distance).toBeCloseTo(20, 0);
  });

  it("describes the walk in plain words", () => {
    const route = findWalkingRoute(network, at(0, -20), at(0, 0));
    const sentences = route.steps.map((step) => step.instruction);
    expect(sentences[0]).toMatch(/^Head (east|west|southeast|southwest|northeast|northwest)/);
    expect(sentences.slice(1, -1).every((s) => /^(Turn|Bear|Make a sharp|Continue)/.test(s))).toBe(true);
    expect(sentences[sentences.length - 1]).toMatch(/^Arrive at the plot — it is on your (left|right)$/);
    // The directions list shows each sentence with its distance.
    expect(formatRouteSteps(route.steps)[0].instruction).toMatch(/^Head \w+ \(\d+ m\)$/);
  });

  it("knows when a start is on site", () => {
    expect(isOnSite(network, at(0, -20))).toBe(true);
    expect(isOnSite(network, at(1000, 0))).toBe(false);
  });

  it("returns null without any rows", () => {
    expect(findWalkingRoute(buildWalkwayNetwork([]), at(0, 0), at(5, 5))).toBeNull();
  });
});
