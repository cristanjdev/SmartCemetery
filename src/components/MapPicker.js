"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GoogleMap, MarkerF, useJsApiLoader } from "@react-google-maps/api";
import { getClientMapCenter, getClientGoogleMapsApiKey } from "../lib/config";
import { installMapsAuthFailureHandler, useMapsAuthFailed } from "@/lib/maps-auth";
import { MapUnavailable } from "@/components/map/MapUnavailable";

const CONTAINER_STYLE = { width: "100%", height: "300px", borderRadius: "var(--radius-md)" };

// Report a rejected API key to us before the Maps script runs.
if (typeof window !== "undefined") installMapsAuthFailureHandler(window);

const OPTIONS = {
  mapTypeId: "hybrid",
  disableDefaultUI: false,
  mapTypeControl: true,
  streetViewControl: false,
  fullscreenControl: false,
  zoomControl: true,
  gestureHandling: "greedy",
  clickableIcons: false,
  maxZoom: 24,
};

export default function MapPicker({ defaultLat, defaultLng, onChange }) {
  const [position, setPosition] = useState(
    defaultLat && defaultLng ? { lat: Number(defaultLat), lng: Number(defaultLng) } : null
  );

  // Map center is sourced from configuration, not hardcoded (Req 13.4).
  const { lat, lng } = getClientMapCenter();
  const center = useMemo(
    () => (position ? position : { lat, lng }),
    [position, lat, lng]
  );

  const { isLoaded, loadError } = useJsApiLoader({
    id: "cemetery-google-maps",
    googleMapsApiKey: getClientGoogleMapsApiKey(),
  });
  const mapsAuthFailed = useMapsAuthFailed();

  useEffect(() => {
    if (position) onChange(position.lat, position.lng);
  }, [position, onChange]);

  const handleClick = useCallback((event) => {
    if (event.latLng) {
      setPosition({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    }
  }, []);

  if (mapsAuthFailed) {
    return <MapUnavailable />;
  }

  if (loadError) {
    return (
      <div className="alert alert-danger" role="alert">
        The map could not be loaded. Verify the Google Maps API key configuration.
      </div>
    );
  }

  if (!isLoaded) {
    return <div className="spinner spinner-lg" aria-label="Loading map" />;
  }

  return (
    <GoogleMap
      mapContainerStyle={CONTAINER_STYLE}
      center={center}
      zoom={position ? 20 : 18}
      options={OPTIONS}
      onClick={handleClick}
    >
      {position && <MarkerF position={position} draggable onDragEnd={handleClick} />}
    </GoogleMap>
  );
}
