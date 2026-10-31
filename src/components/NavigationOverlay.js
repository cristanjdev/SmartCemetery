"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Navigation, LocateFixed, AlertTriangle, Loader2 } from "lucide-react";
import {
  evaluateNavigationGate,
  formatRouteSteps,
  hasValidCoordinates,
} from "../lib/navigation";

/**
 * NavigationOverlay (Requirement 12)
 *
 * Control panel + routing logic for the step-by-step navigation experience.
 * It is intentionally decoupled from the map: the route geometry is lifted up
 * via `onRouteChange` so the parent (CemeteryMap) renders the polyline on the
 * Google map, keeping map rendering in the map component.
 *
 * Contract:
 *   - The Client selects a plot; `destination` is its GPS ({ lat, lng }).
 *   - The Client supplies an origin (browser geolocation, "Use my location").
 *   - Gate BEFORE routing/logging via `evaluateNavigationGate` (Req 12.4).
 *   - Missing/invalid destination GPS -> "directions unavailable", no route,
 *     no Navigation_Log (Req 12.4).
 *   - Successful route -> render polyline + numbered steps (Req 12.1, 12.2)
 *     then POST /api/navigation to persist origin/destination/timestamp
 *     (Req 12.3).
 *   - Routing failure -> error message, retain current map view, no log
 *     (Req 12.5).
 *
 * @param {{
 *   destination: { lat: number, lng: number } | null,
 *   onRouteChange: (coords: Array<[number, number]> | null) => void,
 *     coords run [origin, ...route..., destination]: the route follows the
 *     roads and then the cemetery aisles; the first and last segments are the
 *     short off-path steps from the user and onto the plot (drawn dashed).
 *   plotId?: number,
 *   channel?: "dashboard" | "kiosk" | "public",
 *   fixedOrigin?: { lat: number, lng: number, label: string },
 *     when set (the on-site kiosk), routes always start here and the
 *     browser's location is never requested.
 *   authenticated?: boolean,
 * }} props
 */
export default function NavigationOverlay({
  destination,
  onRouteChange,
  onViewOnMap,
  plotId,
  channel = "public",
  authenticated = false,
  hideTitle = false,
  flat = false,
  fixedOrigin = null,
  // false: once the route is drawn, the panel stays as it was (no confirmation
  // line or step list); the route and the walker on the map are the guide.
  showDetails = true,
  // Draw the route from `fixedOrigin` as soon as this mounts (the visitor
  // already asked for it, e.g. with "Map Route" in the directory).
  autoStart = false,
}) {
  const [origin, setOrigin] = useState(null);
  const [steps, setSteps] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | locating | routing | ready | error
  const [message, setMessage] = useState("");

  // Destination validity gate (Req 12.4). The parent remounts this component
  // (via a `key` keyed on the selected plot) when the selection changes, so
  // routing state resets naturally without a state-resetting effect.
  const destinationValid = useMemo(
    () => hasValidCoordinates(destination),
    [destination]
  );

  function routeFromFixedOrigin() {
    const start = { lat: fixedOrigin.lat, lng: fixedOrigin.lng };
    setOrigin(start);
    generateRoute(start);
  }

  function requestGeolocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      setMessage("Location services are not available in this browser.");
      return;
    }
    setStatus("locating");
    setMessage("Getting your current location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextOrigin = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setOrigin(nextOrigin);
        generateRoute(nextOrigin);
      },
      (error) => {
        setStatus(error?.code === 1 ? "denied" : "error");
        setMessage(
          error?.code === 1
            ? "Location access was denied. Allow location access in your browser settings, then try again."
            : "Could not determine your location. Check location services and try again."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function generateRoute(originCoords) {
    // Gate BEFORE routing/logging (Req 12.4). Never route or log when the
    // destination GPS is missing/invalid.
    const gate = evaluateNavigationGate({ origin: originCoords, destination });
    if (!gate.ok) {
      setStatus("error");
      setMessage(
        gate.reason === "unavailable"
          ? "Directions unavailable — this plot has no GPS coordinates."
          : "A valid starting location is required to generate a route."
      );
      onRouteChange(null);
      return;
    }

    setStatus("routing");
    setMessage("Generating directions…");

    try {
      const res = await fetch("/api/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: originCoords, destination }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(data?.error?.message || "The route could not be generated.");
        error.type = data?.error?.type;
        throw error;
      }
      const route = data?.routes?.[0];
      if (data?.code !== "Ok" || !route?.geometry?.coordinates?.length) {
        throw new Error("No route found");
      }

      // GeoJSON coordinates are [lng, lat]; the map expects [lat, lng] pairs.
      // The route starts on the nearest road and ends in the aisle beside the
      // plot. Anchor it to the user's real position and the exact plot so the
      // route visibly reaches the grave.
      const roadPath = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const coords = [
        [originCoords.lat, originCoords.lng],
        ...roadPath,
        [destination.lat, destination.lng],
      ];

      // Flatten legs -> steps (in leg order, then step order) before formatting.
      const rawSteps = Array.isArray(route.legs)
        ? route.legs.flatMap((leg) => (Array.isArray(leg.steps) ? leg.steps : []))
        : [];

      setSteps(formatRouteSteps(rawSteps));
      onRouteChange(coords);
      setStatus("ready");
      setMessage("");

      // Usage logging is intentionally separate from public routing. Only an
      // authenticated dashboard session makes the best-effort log request.
      if (channel === "dashboard" && authenticated) {
        persistLog(route);
      }
    } catch (err) {
      // Routing failure -> error message, retain current map view, no log.
      console.error("Navigation route generation failed:", err);
      setStatus("error");
      setMessage(
        err?.type === "ROUTING_TIMEOUT"
          ? "The routing service timed out. Please try again."
          : err?.message || "The route could not be generated. Please try again."
      );
    }
  }

  function persistLog(route) {
    // Store only a coarse plot destination and aggregate metrics. Precise user
    // origin coordinates remain in memory and are never persisted.
    fetch("/api/navigation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: plotId ? `plot:${plotId}` : "cemetery-route",
        plotId,
        channel,
        distanceMeters: Number.isFinite(route?.distance) ? Math.round(route.distance) : undefined,
        durationSeconds: Number.isFinite(route?.duration) ? Math.round(route.duration) : undefined,
      }),
    }).catch((err) => {
      console.error("Failed to persist navigation log:", err);
    });
  }

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || !fixedOrigin || !destinationValid || autoStarted.current) return undefined;
    // Marked inside the timer, so a cancelled first run (React's dev double
    // effect) does not stop the real one.
    const timer = setTimeout(() => {
      autoStarted.current = true;
      routeFromFixedOrigin();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, destinationValid]);

  if (!destination) return null;

  const isBusy = status === "locating" || status === "routing";
  const hasError = status === "error" || status === "denied";


  return (
    <div style={flat ? { width: "100%" } : {
      background: "rgba(255, 255, 255, 0.03)",
      border: "1px solid rgba(255, 255, 255, 0.08)",
      borderRadius: "var(--radius-md)",
      padding: "0.85rem 1rem",
    }}>
      {!hideTitle && (
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <div className="flex items-center gap-xs">
            <Navigation size={15} style={{ color: "var(--primary-light)" }} />
            <h4 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600 }}>Directions</h4>
          </div>
          {origin && status === "ready" && onViewOnMap && (
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={onViewOnMap}
              style={{ fontSize: "0.75rem", padding: "3px 10px", height: "auto" }}
            >
              View on Map →
            </button>
          )}
        </div>
      )}

      {!destinationValid ? (
        // Missing/invalid destination GPS -> directions unavailable, no route,
        // no Navigation_Log (Req 12.4).
        <div
          role="status"
          className="flex items-center gap-xs text-sm"
          style={{ color: "var(--danger, #ef4444)" }}
        >
          <AlertTriangle size={15} />
          <span>Directions unavailable — this plot has no GPS coordinates.</span>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary btn-sm flex items-center justify-center gap-xs"
            onClick={fixedOrigin ? routeFromFixedOrigin : requestGeolocation}
            disabled={isBusy}
            aria-busy={isBusy}
            style={{ width: "100%" }}
          >
            {isBusy ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : (
              <LocateFixed size={15} aria-hidden="true" />
            )}
            {fixedOrigin
              ? `Show route from ${fixedOrigin.label}`
              : status === "ready"
                ? "Recalculate from my location"
                : "Use my location"}
          </button>

          {message && status !== "ready" && (
            <p
              role={hasError ? "alert" : "status"}
              className="text-sm"
              style={{
                marginTop: 8,
                marginBottom: 0,
                color: hasError
                  ? "var(--danger, #ef4444)"
                  : "var(--text-muted, #94a3b8)",
              }}
            >
              {message}
            </p>
          )}

          {!showDetails && status === "ready" && (
            <span
              role="status"
              style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}
            >
              The walking route is shown on the map.
            </span>
          )}

          {showDetails && origin && status === "ready" && (
            <div style={{ marginTop: 8 }}>
              <p className="text-sm" style={{ margin: "0 0 6px 0", color: "var(--accent-light, #34d399)", fontWeight: 500 }}>
                {fixedOrigin
                  ? `✓ Route from ${fixedOrigin.label}`
                  : "✓ Route calculated from your location"}
              </p>
              {onViewOnMap && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm flex items-center justify-center gap-xs"
                  onClick={onViewOnMap}
                  style={{ width: "100%", marginTop: 4 }}
                >
                  <Navigation size={14} /> View Route on Map
                </button>
              )}
            </div>
          )}

          {showDetails && steps.length > 0 && (
            <ol
              aria-label="Step-by-step directions"
              style={{
                marginTop: 10,
                paddingLeft: 18,
                display: "grid",
                gap: 5,
                maxHeight: 140,
                overflowY: "auto",
                borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                paddingTop: 8,
                marginBottom: 0
              }}
            >
              {steps.map((s) => (
                <li key={s.step} className="text-xs text-muted" style={{ lineHeight: 1.4 }}>
                  {s.instruction}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
