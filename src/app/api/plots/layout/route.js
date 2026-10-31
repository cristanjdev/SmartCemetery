import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getClientIp } from "@/lib/audit";
import { boundedRateLimit, consumeRateLimit } from "@/lib/rate-limit";
import { PUBLIC_LAYOUT_SELECT, publicLayoutPlot } from "@/lib/plot-query";
import { schemaOutOfDateResponse } from "@/lib/db-errors";

/**
 * GET /api/plots/layout — public: every pinned plot's position, status and
 * occupied tier numbers, so the public map navigator can draw the whole
 * cemetery with vacant and occupied tiers. No names or grave details.
 */
export async function GET(request) {
  const limit = boundedRateLimit("LAYOUT_RATE_LIMIT_MAX", 30, 5, 1_000);
  let throttle;
  try {
    throttle = await consumeRateLimit({
      scope: "plot-layout",
      identifier: getClientIp(request) || "unresolved",
      limit,
      windowMs: 60_000,
    });
  } catch {
    return NextResponse.json(
      { error: { type: "rate_limit_unavailable", message: "The map is temporarily unavailable" } },
      { status: 503 }
    );
  }
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: { type: "rate_limit", message: "Too many requests. Please try again shortly." } },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
    );
  }

  try {
    const plots = await prisma.plot.findMany({
      where: { gpsLat: { not: null }, gpsLng: { not: null } },
      select: PUBLIC_LAYOUT_SELECT,
    });
    return NextResponse.json(
      { plots: plots.map(publicLayoutPlot) },
      { headers: { "Cache-Control": "public, max-age=60" } }
    );
  } catch (err) {
    const outdated = schemaOutOfDateResponse(err);
    if (outdated) return outdated;
    return NextResponse.json(
      { error: { type: "server", message: "Could not load the cemetery layout" } },
      { status: 500 }
    );
  }
}
