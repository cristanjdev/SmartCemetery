"use client";

import { getPlotStatusColor } from "@/lib/map-geometry";
import BlockTypeLegend from "@/components/map/BlockTypeLegend";

/** The plot statuses the system has (prisma/schema.prisma, enum PlotStatus). */
export const PLOT_STATUS_KEY = [
  { key: "available", label: "Available" },
  { key: "occupied", label: "Occupied" },
  { key: "reserved", label: "Reserved" },
  { key: "maintenance", label: "Maintenance" },
];

/**
 * The staff map's status key, shared by the 2D and 3D maps so it looks and
 * sits the same in both: top left, under the 2D/3D switch. Tapping a status
 * filters the map to it. On phones it folds into a "Key" button, and the block
 * types (which have their own strip on wider screens) are listed inside it.
 *
 * @param {{ filter: string, onFilter: (status: string) => void, belowSwitch?: boolean,
 *           collapsible?: boolean, open?: boolean, onToggle?: () => void }} props
 */
export default function MapStatusKey({ filter, onFilter, belowSwitch = true, collapsible = false, open = true, onToggle }) {
  return (
    <div
      role="group"
      aria-label="Plot status"
      className={`map-status-key${belowSwitch ? "" : " is-top"}${collapsible ? " is-collapsible" : ""}${open ? " is-open" : ""}`}
    >
      {collapsible && (
        <button type="button" className="map-status-key-toggle" onClick={onToggle} aria-expanded={open}>
          {open ? "Hide key" : "Key"}
        </button>
      )}
      {open &&
        PLOT_STATUS_KEY.map((item) => {
          const active = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className="map-status-key-item"
              aria-pressed={active}
              title={`Show only ${item.label.toLowerCase()} plots`}
              onClick={() => onFilter(active ? "all" : item.key)}
            >
              <span className="map-status-key-swatch" style={{ background: getPlotStatusColor(item.key) }} />
              {item.label}
            </button>
          );
        })}
      {open && filter !== "all" && (
        <button type="button" className="map-status-key-reset" onClick={() => onFilter("all")}>
          Reset filter
        </button>
      )}
      {collapsible && open && (
        <div className="map-status-key-types">
          <BlockTypeLegend />
        </div>
      )}
    </div>
  );
}
