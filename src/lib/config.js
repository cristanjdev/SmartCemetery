// Deployment configuration helpers (Requirements 12, 13).
//
// This module is intentionally free of Prisma / Next.js runtime dependencies so
// that `resolveMapCenter` and `getRoutingConfig` are pure and property-testable.
//
// Client note (Req 13.4): the map components are client components. In Next.js,
// only statically-referenced `process.env.NEXT_PUBLIC_*` values are inlined into
// the browser bundle — passing the whole `process.env` object or using dynamic
// keys is NOT inlined. `getClientMapCenter()` therefore reads the NEXT_PUBLIC_
// values statically and feeds them into the pure `resolveMapCenter`, so the map
// components never hardcode coordinates.

// Documented default center: Bolonsori Public Cemetery (CMP Apartment Rows).
// Must match the MAP_CENTER_LAT/LNG / NEXT_PUBLIC_MAP_CENTER_* values documented
// in `.env.example` and asserted by config.property.test.js.
export const DEFAULT_MAP_CENTER = { lat: 8.4647, lng: 124.6578 };

// Public providers are development-only fallbacks. Production must configure
// managed/self-hosted tiles and a cemetery-specific pedestrian router.
export const DEVELOPMENT_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEVELOPMENT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const DEVELOPMENT_ROUTING_BASE_URL = "https://router.project-osrm.org";

/** Resolve map tile configuration without embedding provider credentials. PURE. */
export function resolveTileConfig(env = {}, { production = false } = {}) {
  const url = typeof env.MAP_TILE_URL === "string" ? env.MAP_TILE_URL.trim() : "";
  const attribution =
    typeof env.MAP_TILE_ATTRIBUTION === "string"
      ? env.MAP_TILE_ATTRIBUTION.trim()
      : "";

  if (url && attribution) {
    return { url, attribution, configured: true };
  }
  if (production) {
    return { url: null, attribution: "", configured: false };
  }
  return {
    url: DEVELOPMENT_TILE_URL,
    attribution: DEVELOPMENT_TILE_ATTRIBUTION,
    configured: false,
    developmentFallback: true,
  };
}

/**
 * Resolve the map center from environment configuration. PURE.
 *
 * Reads `env.MAP_CENTER_LAT` / `env.MAP_CENTER_LNG`.
 * - Both parse to finite numbers with lat in [-90, 90] and lng in [-180, 180]
 *   -> { lat, lng, source: "config" }                         (Req 13.1)
 * - Both absent (undefined / null / empty string)
 *   -> { ...DEFAULT_MAP_CENTER, source: "default" }            (Req 13.2, no error)
 * - Non-numeric, out of range, or only one coordinate provided
 *   -> { ...DEFAULT_MAP_CENTER, source: "default", invalid: true } (Req 13.3, error flag)
 *
 * The `invalid` flag lets callers log an error indicating the configured center
 * was invalid, while `source: "default"` without `invalid` means "absent".
 *
 * @param {Record<string, unknown>} [env]
 * @returns {{ lat: number, lng: number, source: "config" | "default", invalid?: boolean }}
 */
export function resolveMapCenter(env = {}) {
  const source = env || {};
  const rawLat = source.MAP_CENTER_LAT;
  const rawLng = source.MAP_CENTER_LNG;

  const isAbsent = (v) => v === undefined || v === null || v === "";
  const latAbsent = isAbsent(rawLat);
  const lngAbsent = isAbsent(rawLng);

  // Both absent -> plain default, no error (Req 13.2).
  if (latAbsent && lngAbsent) {
    return { lat: DEFAULT_MAP_CENTER.lat, lng: DEFAULT_MAP_CENTER.lng, source: "default" };
  }

  const lat = Number(rawLat);
  const lng = Number(rawLng);

  const latValid = !latAbsent && Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const lngValid = !lngAbsent && Number.isFinite(lng) && lng >= -180 && lng <= 180;

  // Both present and within range -> configured center (Req 13.1).
  if (latValid && lngValid) {
    return { lat, lng, source: "config" };
  }

  // Non-numeric, out of range, or partial (only one provided) -> default + invalid flag (Req 13.3).
  return {
    lat: DEFAULT_MAP_CENTER.lat,
    lng: DEFAULT_MAP_CENTER.lng,
    source: "default",
    invalid: true,
  };
}

/** Resolve the cemetery pedestrian routing endpoint. PURE. */
export function getRoutingConfig(env = {}, { production = false } = {}) {
  const rawUrl = typeof env.ROUTING_BASE_URL === "string"
    ? env.ROUTING_BASE_URL.trim().replace(/\/$/, "")
    : "";
  const rawProfile = typeof env.ROUTING_PROFILE === "string"
    ? env.ROUTING_PROFILE.trim()
    : "";
  const profile = /^[A-Za-z0-9_-]+$/.test(rawProfile) ? rawProfile : "foot";

  if (rawUrl) return { baseUrl: rawUrl, profile, configured: true };
  if (production) return { baseUrl: null, profile: null, configured: false };
  return {
    baseUrl: DEVELOPMENT_ROUTING_BASE_URL,
    profile: "driving",
    configured: false,
    developmentFallback: true,
  };
}

/** Client-safe tile configuration (retained for non–Google map fallbacks). */
export function getClientTileConfig() {
  return resolveTileConfig(
    {
      MAP_TILE_URL: process.env.NEXT_PUBLIC_MAP_TILE_URL,
      MAP_TILE_ATTRIBUTION: process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION,
    },
    { production: process.env.NODE_ENV === "production" }
  );
}

/**
 * Client-safe Google Maps browser API key accessor (Req 4.9, §7 tech stack).
 *
 * The Maps JavaScript API runs in the browser, so the key must be exposed via
 * a statically-referenced `NEXT_PUBLIC_` variable that Next.js inlines into the
 * client bundle. The key itself is not a confidential server secret; it is
 * protected by HTTP-referrer and API restrictions configured in Google Cloud.
 * Returns an empty string when unset so callers can render a safe fallback.
 *
 * @returns {string}
 */
export function getClientGoogleMapsApiKey() {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return typeof key === "string" ? key.trim() : "";
}

/**
 * Client-safe map center accessor for React client components (Req 13.4).
 *
 * Reads the NEXT_PUBLIC_ map-center values (statically referenced so Next.js
 * inlines them into the browser bundle) and resolves them via the pure
 * `resolveMapCenter`. Logs an error when the configured center is invalid or
 * partial (Req 13.3), then falls back to the documented default.
 *
 * @returns {{ lat: number, lng: number, source: "config" | "default", invalid?: boolean }}
 */
export function getClientMapCenter() {
  const center = resolveMapCenter({
    MAP_CENTER_LAT: process.env.NEXT_PUBLIC_MAP_CENTER_LAT,
    MAP_CENTER_LNG: process.env.NEXT_PUBLIC_MAP_CENTER_LNG,
  });

  if (center.invalid && typeof console !== "undefined") {
    console.error(
      "[config] Configured map center (NEXT_PUBLIC_MAP_CENTER_LAT/LNG) is invalid or partial; " +
        "falling back to default center."
    );
  }

  return center;
}

// ─── Site identity and layout defaults ──────────────────────────────────────
// Everything that is specific to one cemetery lives here (or in env), never in
// components. NEXT_PUBLIC_* values are referenced statically so Next.js inlines
// them into the browser bundle; all have a working default.

function envText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function envNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max
    ? n
    : fallback;
}

/** Full display name, e.g. "Bolonsori Public Cemetery". */
export const SITE_NAME = envText(process.env.NEXT_PUBLIC_SITE_NAME, "Bolonsori Public Cemetery");

/**
 * Fixed starting point for kiosk directions. The kiosk is a stationary screen
 * on site, so every route starts where it stands rather than from browser
 * geolocation (which desktops estimate from the network, often kilometres
 * off). Defaults to the CMP Admin Office; override with
 * NEXT_PUBLIC_KIOSK_START_LAT / _LNG / _LABEL.
 */
export const KIOSK_START_POINT = {
  lat: envNumber(process.env.NEXT_PUBLIC_KIOSK_START_LAT, 8.4661065, { min: -90, max: 90 }),
  lng: envNumber(process.env.NEXT_PUBLIC_KIOSK_START_LNG, 124.65747, { min: -180, max: 180 }),
  label: envText(process.env.NEXT_PUBLIC_KIOSK_START_LABEL, "CMP Admin Office"),
};

/** Short brand word used in tight spaces, e.g. "Bolonsori". */
export const SITE_SHORT_NAME = envText(process.env.NEXT_PUBLIC_SITE_SHORT_NAME, "Bolonsori");

/**
 * Reference rotation (degrees) of the burial-row grid. It is the default angle
 * for new building layouts and the frame in which the boundary polygon is
 * stored, so changing it after boundaries are saved rotates them.
 */
export const DEFAULT_GRID_ANGLE_DEG = envNumber(process.env.NEXT_PUBLIC_GRID_ANGLE, 37.7, {
  min: -360,
  max: 360,
});

/** Tiers per multi-tier building plot created by the layout tools. */
export const DEFAULT_BUILDING_TIERS = Math.round(
  envNumber(process.env.NEXT_PUBLIC_DEFAULT_BUILDING_TIERS, 4, { min: 2, max: 20 })
);

/** Starting footprint (metres) offered when generating a new building. */
export const DEFAULT_BUILDING_LENGTH_M = 26.5;
export const DEFAULT_BUILDING_WIDTH_M = 2.8;
