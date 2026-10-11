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
