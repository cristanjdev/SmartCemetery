"use client";

import { useEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";

const TYPES = [
  { key: "map", label: "Map" },
  { key: "satellite", label: "Satellite" },
];

// The one extra layer each base map offers.
const OPTION = {
  map: { label: "Terrain", hint: "Hills and elevation shading" },
  satellite: { label: "Labels", hint: "Road and place names" },
};

const baseOf = (mapTypeId) => (mapTypeId === "roadmap" || mapTypeId === "terrain" ? "map" : "satellite");
const typeIdOf = (base, extra) => (base === "map" ? (extra ? "terrain" : "roadmap") : extra ? "hybrid" : "satellite");

/**
 * Google base-map picker for the 2D map: a Map / Satellite pill (styled like
 * the 2D / 3D switch) with a layers button for the one option that base map
 * has — terrain shading on Map, labels on Satellite.
 *
 * @param {{ mapTypeId: string, onChange: (mapTypeId: string) => void }} props
 */
export default function MapTypeControl({ mapTypeId, onChange }) {
  const base = baseOf(mapTypeId);
  const extraOn = mapTypeId === "terrain" || mapTypeId === "hybrid";
  // Each base map remembers its own option while the other is shown.
  const [extras, setExtras] = useState(() => ({ map: mapTypeId === "terrain", satellite: mapTypeId !== "satellite" }));
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const pickBase = (next) => {
    if (next !== base) onChange(typeIdOf(next, extras[next]));
  };
  const toggleExtra = () => {
    setExtras((prev) => ({ ...prev, [base]: !extraOn }));
    onChange(typeIdOf(base, !extraOn));
  };

  return (
    <div ref={root} className="map-type-control">
      <div className="map-mode-switch is-inset" role="group" aria-label="Base map" data-active={base === "map" ? 0 : 1}>
        <span className="map-mode-switch-thumb" aria-hidden="true" />
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            className="map-mode-switch-option"
            aria-pressed={t.key === base}
            onClick={() => pickBase(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="map-type-options"
        aria-label="Map layers"
        aria-expanded={open}
        aria-haspopup="true"
        title="Map layers"
        onClick={() => setOpen((v) => !v)}
      >
        <Layers size={15} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {open && (
        <div className="map-type-menu">
          <button type="button" role="switch" aria-checked={extraOn} className="map-type-menu-row" onClick={toggleExtra}>
            <span className="map-type-menu-text">
              <span className="map-type-menu-label">{OPTION[base].label}</span>
              <span className="map-type-menu-hint">{OPTION[base].hint}</span>
            </span>
            <span className="map-toggle" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
