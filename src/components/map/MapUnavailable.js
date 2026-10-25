import { MapPinOff } from "lucide-react";

/**
 * Shown in place of a Google map when Google rejects the API key for the
 * current address (see `@/lib/maps-auth`), instead of Google's own
 * "Oops! Something went wrong." box.
 */
export function MapUnavailable() {
  return (
    <div className="map-unavailable" role="status">
      <MapPinOff size={28} aria-hidden="true" />
      <p className="map-unavailable-title">Map unavailable on this address</p>
      <p className="map-unavailable-text">
        Google Maps did not accept this site&apos;s map key, so the map can&apos;t be shown
        here. The grave details and walking directions still work.
      </p>
    </div>
  );
}
