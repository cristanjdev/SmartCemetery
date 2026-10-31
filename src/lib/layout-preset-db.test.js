import { describe, expect, it, vi } from "vitest";
import { layoutFingerprint, renameLayoutRows } from "./layout-preset-db";

/** An in-memory stand-in for the two tables the rename touches. */
function fakeDb(details, plots) {
  return {
    details,
    plots,
    locationDetail: {
      findFirst: vi.fn(async ({ where, include }) => {
        const d = details.find((x) => x.locationId === where.locationId && x.subsection === where.subsection);
        return d && include?.plots ? { ...d, plots: plots.filter((p) => p.locationDetailId === d.id) } : d || null;
      }),
      update: vi.fn(async ({ where, data }) => Object.assign(details.find((d) => d.id === where.id), data)),
    },
    plot: {
      update: vi.fn(async ({ where, data }) => Object.assign(plots.find((p) => p.id === where.id), data)),
    },
  };
}

describe("renameLayoutRows", () => {
  const preset = { renamedRows: { "ROW-E05": "FBN-B2" } };

  it("gives a row and its plot numbers the directory name, once", async () => {
    const db = fakeDb(
      [{ id: 1, locationId: 9, subsection: "ROW-E05" }],
      [
        { id: 10, locationDetailId: 1, plotNumber: "ROW-E05-C01-A" },
        { id: 11, locationDetailId: 1, plotNumber: "ROW-E05-C01-B" },
      ]
    );
    expect(await renameLayoutRows(db, preset, 9)).toEqual([{ from: "ROW-E05", to: "FBN-B2", plots: 2 }]);
    expect(db.details[0].subsection).toBe("FBN-B2");
    expect(db.plots.map((p) => p.plotNumber)).toEqual(["FBN-B2-C01-A", "FBN-B2-C01-B"]);
    // Again: nothing left to rename.
    expect(await renameLayoutRows(db, preset, 9)).toEqual([]);
  });

  it("leaves both rows alone when the new name is already taken", async () => {
    const db = fakeDb(
      [
        { id: 1, locationId: 9, subsection: "ROW-E05" },
        { id: 2, locationId: 9, subsection: "FBN-B2" },
      ],
      [{ id: 10, locationDetailId: 1, plotNumber: "ROW-E05-C01-A" }]
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await renameLayoutRows(db, preset, 9)).toEqual([]);
    expect(db.plots[0].plotNumber).toBe("ROW-E05-C01-A");
    warn.mockRestore();
  });
});

describe("layoutFingerprint", () => {
  const preset = { tiersPerPlot: 4, rows: { "FBN-B2": { plots: [{ plotNumber: "FBN-B2-C01-A", lat: 8.1, lng: 124.1 }] } } };

  it("is the same for the same layout and changes when any plot moves or a row is renamed", () => {
    expect(layoutFingerprint(preset)).toBe(layoutFingerprint(JSON.parse(JSON.stringify(preset))));
    const moved = JSON.parse(JSON.stringify(preset));
    moved.rows["FBN-B2"].plots[0].lat = 8.10001;
    expect(layoutFingerprint(moved)).not.toBe(layoutFingerprint(preset));
    expect(layoutFingerprint({ ...preset, renamedRows: { "ROW-E05": "FBN-B2" } })).not.toBe(layoutFingerprint(preset));
  });
});

