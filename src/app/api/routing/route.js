import { NextResponse } from "next/server";
import {
  requestRoute,
  RoutingServiceError,
  validateRoutingRequest,
} from "@/lib/routing";
import { loadWalkwayNetwork } from "@/lib/walkway-data";
import { getClientIp } from "@/lib/audit";
import { boundedRateLimit, consumeRateLimit } from "@/lib/rate-limit";

export async function POST(request) {
  // This route is intentionally public (public/kiosk directions), but it calls
  // an external routing provider with caller-supplied coordinates, so it must
  // be rate limited by client IP to prevent quota/cost abuse.
  const baseLimit = boundedRateLimit("ROUTING_RATE_LIMIT_MAX", 120, 10, 5_000);
  const windowSeconds = boundedRateLimit("ROUTING_RATE_LIMIT_WINDOW_SECONDS", 60, 10, 3_600);
  let throttle;
  try {
    throttle = await consumeRateLimit({
      scope: "routing",
      identifier: getClientIp(request) || "unresolved",
      limit: baseLimit,
      windowMs: windowSeconds * 1000,
    });
  } catch {
    return NextResponse.json(
      { error: { type: "rate_limit_unavailable", message: "Routing is temporarily unavailable." } },
      { status: 503 }
    );
  }
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: { type: "rate_limit", message: "Too many route requests. Please try again shortly." } },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { type: "INVALID_REQUEST", message: "A valid JSON request body is required." } },
      { status: 400 }
    );
  }

  try {
    const coordinates = validateRoutingRequest(body);
    // Without the rows (e.g. the database is unreachable) the road provider
    // still routes, just without the walk through the aisles.
    const walkways = await loadWalkwayNetwork().catch((error) => {
      console.error("Walkway network unavailable:", error);
      return null;
    });
    const route = await requestRoute(coordinates, { walkways });
    return NextResponse.json(route);
  } catch (error) {
    if (error instanceof RoutingServiceError) {
      return NextResponse.json(
        { error: { type: error.code, message: error.message } },
        { status: error.status }
      );
    }
    console.error("POST /api/routing error:", error);
    return NextResponse.json(
      { error: { type: "ROUTING_PROVIDER_ERROR", message: "The route could not be generated." } },
      { status: 502 }
    );
  }
}