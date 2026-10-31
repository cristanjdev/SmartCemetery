import { describe, it, expect } from "vitest";
import {
  getPlotStatusColor,
  getPlotCorners,
  isActiveBuildingPlot,
  getBuildingsCenter,
  getBoundaryCoords,
  coordsToBoundaryOffsets,
  deriveBoundaryOffsets,
  splitCellAcross,
} from "@/lib/map-geometry";
import { latLngToLocalOffset, localOffsetToLatLng } from "@/lib/building-grid";

const building = (id, lat, lng, extra = {}) => ({
  id,
  plotNumber: `B-C${id}`,
  totalTiers: 4,
  gpsLat: lat,
  gpsLng: lng,
  locationDetail: { subsection: "B" },
  ...extra,
});

describe("map-geometry", () => {
  it("maps plot status to a colour with a default", () => {
    expect(getPlotStatusColor("occupied")).not.toBe(getPlotStatusColor("available"));
    expect(getPlotStatusColor("RESERVED")).toBe(getPlotStatusColor("reserved"));
    expect(new Set(["available", "occupied", "reserved", "maintenance"].map(getPlotStatusColor)).size).toBe(4);
    expect(getPlotStatusColor(undefined)).toBe(getPlotStatusColor("unknown"));
  });

  it("returns the four corners of a plot footprint around its centre", () => {
    const corners = getPlotCorners({ lat: 8.46, lng: 124.65 });
    expect(corners).toHaveLength(4);
    const avgLat = corners.reduce((s, c) => s + c.lat, 0) / 4;
    const avgLng = corners.reduce((s, c) => s + c.lng, 0) / 4;
    expect(avgLat).toBeCloseTo(8.46, 6);
    expect(avgLng).toBeCloseTo(124.65, 6);
  });

  it("treats only live multi-tier plots as building plots, whatever they are named or where they are", () => {
    expect(isActiveBuildingPlot(building(1, 1, 1))).toBe(true);
    expect(isActiveBuildingPlot(building(1, 1, 1, { plotNumber: "Whatever", locationDetail: { locationId: 99 } }))).toBe(true);
    expect(isActiveBuildingPlot(building(1, 1, 1, { totalTiers: 1, plotNumber: "ROW-E01-C01" }))).toBe(false);
    expect(isActiveBuildingPlot(building(1, 1, 1, { _deleted: true }))).toBe(false);
    expect(isActiveBuildingPlot(null)).toBe(false);
  });

  it("centres on pinned building plots only", () => {
    const plots = [
      building(1, 10, 20),
      building(2, 12, 22),
      building(3, null, null),
      { id: 4, plotNumber: "Lawn-1", totalTiers: 1, gpsLat: 50, gpsLng: 50 },
    ];
    expect(getBuildingsCenter(plots)).toEqual({ lat: 11, lng: 21 });
    expect(getBuildingsCenter([{ id: 4, totalTiers: 1, gpsLat: 1, gpsLng: 1 }])).toBeNull();
    expect(getBuildingsCenter([])).toBeNull();
  });

  it("returns no polygon for fewer than 3 offsets", () => {
    expect(getBoundaryCoords(8.46, 124.65, 37.7, [{ dx: 1, dy: 1 }])).toEqual([]);
    expect(getBoundaryCoords(8.46, 124.65, 37.7, null)).toEqual([]);
  });

  it("round-trips offsets through lat/lng at any grid rotation", () => {
    const offsets = [
      { dx: -20, dy: 15 },
      { dx: 25, dy: 12 },
      { dx: 10, dy: -18 },
    ];
    const lat = 8.46584789;
    const lng = 124.65701478;
    for (const angle of [37.7, 0, 90, 123.4]) {
      const coords = getBoundaryCoords(lat, lng, angle, offsets);
      const back = coordsToBoundaryOffsets(coords, lat, lng, angle);
      back.forEach((o, i) => {
        expect(o.dx).toBeCloseTo(offsets[i].dx, 1);
        expect(o.dy).toBeCloseTo(offsets[i].dy, 1);
      });
    }
  });

  describe("deriveBoundaryOffsets", () => {
    it("widens to take in extra points (blocks without plots yet)", () => {
      const grid = [
        { id: 1, totalTiers: 4, gpsLat: 8.4657, gpsLng: 124.657 },
        { id: 2, totalTiers: 4, gpsLat: 8.4658, gpsLng: 124.6571 },
      ];
      const span = (offsets) => Math.max(...offsets.map((o) => Math.hypot(o.dx ?? o[0] ?? 0, o.dy ?? o[1] ?? 0)));
      const plain = deriveBoundaryOffsets(grid, 30, 6);
      const wider = deriveBoundaryOffsets(grid, 30, 6, [{ lat: 8.4667, lng: 124.6581 }]);
      expect(span(wider)).toBeGreaterThan(span(plain) + 50);
      expect(deriveBoundaryOffsets(grid, 30, 6, [{ lat: Number.NaN, lng: 1 }])).toEqual(plain);
    });

    const centre = { lat: 8.4658, lng: 124.657 };
    const grid = [-10, -3, 4, 12].map((dx, i) => {
      const pos = localOffsetToLatLng(dx, (i % 2) * 2, centre.lat, centre.lng, 30);
      return building(i + 1, pos.lat, pos.lng);
    });

    it("returns null when there is nothing to enclose", () => {
      expect(deriveBoundaryOffsets([], 30)).toBeNull();
      expect(deriveBoundaryOffsets([{ id: 1, totalTiers: 1, gpsLat: 1, gpsLng: 1 }], 30)).toBeNull();
    });

    it("encloses every building plot with padding, at any rotation", () => {
      for (const angle of [30, 0, 37.7, 95]) {
        const offsets = deriveBoundaryOffsets(grid, angle, 6);
        expect(offsets).toHaveLength(4);
        const center = getBuildingsCenter(grid);
        const polygon = getBoundaryCoords(center.lat, center.lng, angle, offsets);

        // Every plot must lie inside the polygon (point-in-polygon, ray casting in local metres).
        const local = polygon.map((c) => latLngToLocalOffset(c.lat, c.lng, center.lat, center.lng, 0));
        const inside = (pt) => {
          let hit = false;
          for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
            const a = local[i];
            const b = local[j];
            if (a.dy > pt.dy !== b.dy > pt.dy && pt.dx < ((b.dx - a.dx) * (pt.dy - a.dy)) / (b.dy - a.dy) + a.dx) hit = !hit;
          }
          return hit;
        };
        for (const p of grid) {
          expect(inside(latLngToLocalOffset(p.gpsLat, p.gpsLng, center.lat, center.lng, 0))).toBe(true);
        }
      }
    });

    it("ignores ordinary lots and deleted plots", () => {
      const noisy = [...grid, { id: 99, totalTiers: 1, gpsLat: 40, gpsLng: 40 }, building(100, 41, 41, { _deleted: true })];
      expect(deriveBoundaryOffsets(noisy, 30, 6)).toEqual(deriveBoundaryOffsets(grid, 30, 6));
    });
  });
});

describe("splitCellAcross", () => {
  const cell = [
    { lat: 1, lng: 0 },
    { lat: 1, lng: 4 },
    { lat: 0, lng: 4 },
    { lat: 0, lng: 0 },
  ];

  it("cuts a cell into one full-length strip per tier, tier 1 on the c3-c2 side", () => {
    const strips = splitCellAcross(cell, 4);
    expect(strips).toHaveLength(4);
    expect(strips[0][0]).toEqual({ lat: 0, lng: 0 });
    expect(strips[0][1]).toEqual({ lat: 0, lng: 4 });
    expect(strips[0][2].lat).toBeCloseTo(0.25, 9);
    expect(strips[3][3]).toEqual({ lat: 1, lng: 0 });
  });

  it("colours a partly filled column as occupied (its vacant tiers are drawn as strips)", () => {
    expect(getPlotStatusColor("partial")).toBe(getPlotStatusColor("occupied"));
  });
});
