import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    location: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    locationDetail: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    plot: {
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    grave: {
      create: vi.fn(),
    },
    appSetting: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/encryption", () => ({
  encryptGraveDetail: vi.fn((detail) => ({ ...detail, encryptionKeyVersion: "v1" })),
}));

import { POST } from "./route";
import { LAYOUT_PRESET_SUMMARY } from "@/lib/layout-preset";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";

function makeRequest() {
  return new Request("http://localhost/api/plots/preset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/plots/preset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRole.mockResolvedValue({ ok: true, user: { id: 1 } });
    prisma.location.findFirst.mockResolvedValue({ id: 4, name: "City Memorial Park (CMP) - Bolonsiri" });
    prisma.locationDetail.findFirst.mockImplementation(({ where }) =>
      Promise.resolve({ id: 100, subsection: where.subsection })
    );
    prisma.plot.upsert.mockResolvedValue({ id: 200, plotNumber: "TEST-01", graves: [] });
    prisma.plot.findMany.mockResolvedValue([]);
  });

  it("rejects unauthorized users", async () => {
    requireRole.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it("applies preset and returns 200 with plots", async () => {
    prisma.plot.findMany.mockResolvedValue([
      { id: 1, plotNumber: "ROW-E01-C01", gpsLat: 8.465, gpsLng: 124.656 },
    ]);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.totalPlots).toBe(LAYOUT_PRESET_SUMMARY.totalPlots);
    expect(data.plots.length).toBe(1);
  });

  it("lays out plots with their tier count but never creates burial records", async () => {
    await POST(makeRequest());
    expect(prisma.grave.create).not.toHaveBeenCalled();
    expect(prisma.plot.upsert).toHaveBeenCalledTimes(LAYOUT_PRESET_SUMMARY.totalPlots);
    const { create, update } = prisma.plot.upsert.mock.calls[0][0];
    expect(create.totalTiers).toBeGreaterThan(1);
    expect(update.totalTiers).toBe(create.totalTiers);
    // re-applying must not overwrite an existing plot's status
    expect(update).not.toHaveProperty("status");
  });

  it("attaches to the location named by LAYOUT_LOCATION_NAME instead of the preset's", async () => {
    process.env.LAYOUT_LOCATION_NAME = "Hillside Memorial";
    try {
      prisma.location.findFirst.mockResolvedValue(null);
      prisma.location.create.mockResolvedValue({ id: 9, name: "Hillside Memorial" });
      await POST(makeRequest());
      expect(prisma.location.findFirst).toHaveBeenCalledWith({
        where: { name: { contains: "Hillside Memorial" } },
      });
      expect(prisma.location.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: "Hillside Memorial" }) })
      );
    } finally {
      delete process.env.LAYOUT_LOCATION_NAME;
    }
  });

  it("does not move a location that already has coordinates", async () => {
    prisma.location.findFirst.mockResolvedValue({ id: 4, name: "Existing", gpsLat: 1, gpsLng: 2 });
    await POST(makeRequest());
    expect(prisma.location.update).not.toHaveBeenCalled();
  });

  it("fills in missing location coordinates from the preset", async () => {
    prisma.location.findFirst.mockResolvedValue({ id: 4, name: "Existing", gpsLat: null, gpsLng: null });
    await POST(makeRequest());
    expect(prisma.location.update).toHaveBeenCalledTimes(1);
  });
});
