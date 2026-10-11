import { DEFAULT_MAP_CENTER, KIOSK_START_POINT, resolveMapCenter } from "@/lib/config";
import { hasValidCoordinates } from "@/lib/navigation";
import { findWalkingRoute, isOnSite } from "@/lib/walkways";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RADIUS_METERS = 5_000;

export class RoutingServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "RoutingServiceError";
    this.status = status;
    this.code = code;
  }
}

function strictCoordinate(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RoutingServiceError(400, "INVALID_COORDINATES", `${label} must contain numeric lat and lng values.`);
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "lat" || keys[1] !== "lng" || !hasValidCoordinates(value)) {
    throw new RoutingServiceError(400, "INVALID_COORDINATES", `${label} must contain only valid numeric lat and lng values.`);
  }
  return { lat: value.lat, lng: value.lng };
}

export function validateRoutingRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RoutingServiceError(400, "INVALID_REQUEST", "A JSON request body is required.");
  }
  return {
    origin: strictCoordinate(body.origin, "origin"),
    destination: strictCoordinate(body.destination, "destination"),
  };
}

export function distanceMeters(a, b) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(haversine));
}

export function getServerRoutingConfig(env = process.env) {
  const rawBaseUrl = typeof env.ROUTING_BASE_URL === "string" ? env.ROUTING_BASE_URL.trim() : "";
  const rawProfile = typeof env.ROUTING_PROFILE === "string" ? env.ROUTING_PROFILE.trim() : "";
  const production = env.NODE_ENV === "production";
  if (!rawBaseUrl && production) {
    throw new RoutingServiceError(503, "ROUTING_UNAVAILABLE", "Routing is temporarily unavailable.");
  }

  let baseUrl;
  try {
    baseUrl = new URL(rawBaseUrl || "https://router.project-osrm.org");
  } catch {
    throw new RoutingServiceError(503, "ROUTING_UNAVAILABLE", "Routing is temporarily unavailable.");
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new RoutingServiceError(503, "ROUTING_UNAVAILABLE", "Routing is temporarily unavailable.");
  }

  const profile = rawProfile || (production ? "foot" : "driving");
  if (!/^[A-Za-z0-9_-]+$/.test(profile)) {
    throw new RoutingServiceError(503, "ROUTING_UNAVAILABLE", "Routing is temporarily unavailable.");
  }
  const timeoutValue = Number(env.ROUTING_TIMEOUT_MS);
  const radiusValue = Number(env.ROUTING_MAX_RADIUS_METERS);
  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    profile,
    timeoutMs: Number.isFinite(timeoutValue) && timeoutValue >= 100 && timeoutValue <= 30_000
      ? timeoutValue
      : DEFAULT_TIMEOUT_MS,
    radiusMeters: Number.isFinite(radiusValue) && radiusValue >= 100 && radiusValue <= 100_000
      ? radiusValue
      : DEFAULT_RADIUS_METERS,
    center: resolveMapCenter(env) || DEFAULT_MAP_CENTER,
    // Where visitors arriving from outside walk into the cemetery (the
    // admin office, also the kiosk's spot).
    entrance: KIOSK_START_POINT,
  };
}

function assertWithinCemeteryRadius({ destination }, config) {
  // Only the destination (plot GPS) must be within the cemetery boundary.
  // The user's origin is their real-world location and can be anywhere —
  // restricting it would break navigation for anyone not already on-site.
  if (distanceMeters(config.center, destination) > config.radiusMeters) {
    throw new RoutingServiceError(400, "OUTSIDE_CEMETERY_AREA", "destination is outside the supported cemetery area.");
  }
}


function safeRoute(providerData) {
  const route = providerData?.routes?.[0];
  const coordinates = route?.geometry?.coordinates;
  if (providerData?.code !== "Ok" || !Array.isArray(coordinates) || coordinates.length < 2) {
    throw new RoutingServiceError(502, "INVALID_PROVIDER_RESPONSE", "The routing provider returned no usable route.");
  }
  const safeCoordinates = coordinates.map((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      throw new RoutingServiceError(502, "INVALID_PROVIDER_RESPONSE", "The routing provider returned an invalid route.");
    }
    const [lng, lat] = point;
    if (!hasValidCoordinates({ lat, lng })) {
      throw new RoutingServiceError(502, "INVALID_PROVIDER_RESPONSE", "The routing provider returned an invalid route.");
    }
    return [lng, lat];
  });
  const legs = Array.isArray(route.legs)
    ? route.legs.map((leg) => ({
        steps: Array.isArray(leg.steps)
          ? leg.steps.map((step) => ({
              distance: Number.isFinite(step?.distance) ? step.distance : 0,
              name: typeof step?.name === "string" ? step.name.slice(0, 200) : "",
              maneuver: {
                type: typeof step?.maneuver?.type === "string" ? step.maneuver.type.slice(0, 50) : "",
                modifier: typeof step?.maneuver?.modifier === "string" ? step.maneuver.modifier.slice(0, 50) : "",
              },
            }))
          : [],
      }))
    : [];
  return {
    geometry: { type: "LineString", coordinates: safeCoordinates },
    legs,
    distance: Number.isFinite(route.distance) ? route.distance : null,
    duration: Number.isFinite(route.duration) ? route.duration : null,
  };
}

async function requestProviderRoute(origin, destination, config, options) {
  const routePath = `${config.baseUrl}/route/v1/${encodeURIComponent(config.profile)}/` +
    `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = new URL(routePath);
  url.search = new URLSearchParams({ overview: "full", geometries: "geojson", steps: "true" }).toString();

  let response;
  try {
    response = await (options.fetchImpl || fetch)(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new RoutingServiceError(504, "ROUTING_TIMEOUT", "The routing provider timed out. Please try again.");
    }
    throw new RoutingServiceError(502, "ROUTING_PROVIDER_ERROR", "The routing provider could not be reached.");
  }

  if (!response.ok) {
    const unavailable = response.status === 429 || response.status === 503;
    throw new RoutingServiceError(
      unavailable ? 503 : 502,
      unavailable ? "ROUTING_UNAVAILABLE" : "ROUTING_PROVIDER_ERROR",
      unavailable ? "Routing is temporarily unavailable." : "The routing provider could not generate a route."
    );
  }
  let providerData;
  try {
    providerData = await response.json();
  } catch {
    throw new RoutingServiceError(502, "INVALID_PROVIDER_RESPONSE", "The routing provider returned an invalid response.");
  }
  return safeRoute(providerData);
}

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Join a road route (or none, when the visitor is already on site) and the
 * walk through the aisles into one route in the provider's response shape.
 */
function joinRoute(road, walk, startLabel) {
  const walkSteps = walk.steps.map((step, index) =>
    index === 0 && startLabel
      ? { ...step, instruction: `From the ${startLabel}, ${lowerFirst(step.instruction)}` }
      : step
  );
  const roadSteps = road
    ? road.legs.flatMap((leg) => leg.steps).filter((step) => step.maneuver.type !== "arrive")
    : [];
  const coordinates = [
    ...(road ? road.geometry.coordinates : []),
    ...walk.path.map(({ lat, lng }) => [lng, lat]),
  ];
  return {
    geometry: { type: "LineString", coordinates },
    legs: [{ steps: [...roadSteps, ...walkSteps] }],
    distance: (road?.distance ?? 0) + walk.distance,
    duration: (road?.duration ?? 0) + walk.duration,
  };
}

/**
 * Route from `origin` to a plot. With a walkway network (the building rows),
 * the part inside the cemetery follows the aisles around the rows: a visitor
 * already on site walks from where they are, anyone else is routed by road
 * to the entrance and walks in from there. Without one, the road provider
 * routes the whole way.
 */
export async function requestRoute({ origin, destination }, options = {}) {
  const config = options.config || getServerRoutingConfig(options.env);
  assertWithinCemeteryRadius({ origin, destination }, config);

  const network = options.walkways;
  if (network?.blocks?.length) {
    const entrance = config.entrance;
    const onSite = isOnSite(network, origin);
    const walkStart = onSite ? origin : { lat: entrance.lat, lng: entrance.lng };
    const walk = findWalkingRoute(network, walkStart, destination);
    if (walk) {
      const startsAtEntrance = !onSite || distanceMeters(origin, entrance) < 10;
      const road = onSite ? null : await requestProviderRoute(origin, walkStart, config, options);
      return {
        code: "Ok",
        routes: [joinRoute(road, walk, startsAtEntrance ? entrance.label : "")],
      };
    }
  }

  return { code: "Ok", routes: [await requestProviderRoute(origin, destination, config, options)] };
}
