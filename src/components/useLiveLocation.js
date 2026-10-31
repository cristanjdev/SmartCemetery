"use client";

import { useEffect, useRef, useState } from "react";
import { arrivalAt, readFix } from "@/lib/live-location";

const OFF = { status: "off", position: null };
const UNSUPPORTED = { status: "unsupported", position: null };
const WAITING = { status: "waiting", position: null };

/**
 * Watches the device's GPS while `enabled` (while a walking route is on the
 * map) and reports where the visitor is in relation to the cemetery and the
 * plot. `position` is set only once they are at the cemetery, so until then
 * the walker stays at the route's start. Stops watching when disabled.
 *
 * status:
 *   "off"         no route on the map
 *   "waiting"     no fix yet
 *   "away"        not at the cemetery yet (`awayM` metres from it)
 *   "inaccurate"  at the cemetery but the fix is too rough to place them
 *   "live"        walking (`toPlotM` metres from the plot)
 *   "arrived"     at the plot
 *   "denied" | "unsupported"  no location available
 *
 * @param {boolean} enabled
 * @param {{ lat: number, lng: number } | null} destination the plot
 */
export function useLiveLocation(enabled, destination) {
  const [state, setState] = useState(null);
  const last = useRef(null);
  const arrived = useRef(false);
  const supported = typeof navigator !== "undefined" && Boolean(navigator.geolocation);
  const destLat = destination?.lat;
  const destLng = destination?.lng;

  useEffect(() => {
    if (!enabled || !supported) return undefined;
    last.current = null;
    arrived.current = false;
    const id = navigator.geolocation.watchPosition(
      (fix) => {
        const out = readFix(fix, last.current);
        if (out.position) {
          last.current = out.position;
          let toPlotM = null;
          if (Number.isFinite(destLat) && Number.isFinite(destLng)) {
            const a = arrivalAt(out.position, { lat: destLat, lng: destLng }, arrived.current);
            arrived.current = a.arrived;
            toPlotM = a.distanceM;
          }
          setState({ status: arrived.current ? "arrived" : "live", position: out.position, toPlotM });
        } else if (out.rejected === "away") {
          // Left (or not yet reached) the cemetery: the walker goes back to the start.
          last.current = null;
          arrived.current = false;
          setState({ status: "away", position: null, awayM: out.distanceM });
        } else if (!last.current) {
          setState({ status: out.rejected === "invalid" ? "waiting" : out.rejected, position: null });
        }
        // One rough fix while already placed: keep the last good position.
      },
      (error) => {
        if (error?.code === 1) {
          last.current = null;
          setState({ status: "denied", position: null });
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, supported, destLat, destLng]);

  if (!enabled) return OFF;
  if (!supported) return UNSUPPORTED;
  return state || WAITING;
}
