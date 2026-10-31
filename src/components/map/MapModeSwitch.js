"use client";

import { Box, Map as MapIcon } from "lucide-react";

const MODES = [
  { key: "2d", label: "2D", title: "2D satellite map", Icon: MapIcon },
  { key: "3d", label: "3D", title: "3D park map", Icon: Box },
];

/**
 * The 2D / 3D switch, shared by both maps so it looks and sits the same in
 * either mode: a pill with a sliding thumb under the active view.
 *
 * @param {{ mode: "2d" | "3d", onChange: (mode: "2d" | "3d") => void }} props
 */
export default function MapModeSwitch({ mode, onChange }) {
  return (
    <div className="map-mode-switch" role="group" aria-label="Map view" data-active={mode === "3d" ? 1 : 0}>
      <span className="map-mode-switch-thumb" aria-hidden="true" />
      {MODES.map(({ key, label, title, Icon }) => {
        const active = key === mode;
        return (
          <button
            key={key}
            type="button"
            className="map-mode-switch-option"
            aria-pressed={active}
            title={active ? title : `Switch to the ${title}`}
            onClick={() => !active && onChange(key)}
          >
            <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
