"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Check, Maximize2, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { buildingLabel, columnShortLabel } from "@/lib/cemetery-layout";
import { canAddGrave, tierAvailability } from "@/lib/plot-format";
import { hasPosition, layoutMiniMap, panView, zoomView } from "@/lib/minimap";
import { getClientGoogleMapsApiKey } from "@/lib/config";
import { getPlotStatusColor } from "@/lib/map-geometry";

// The very same map as the Cemetery Map page (2D satellite or 3D, building
// blocks, plot cells, labels). Loaded on demand because it pulls in the map libraries.
const CemeteryMapView = dynamic(() => import("@/components/CemeteryMapView"), {
  ssr: false,
  loading: () => (
    <div style={{ height: "100%", minHeight: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="spinner spinner-lg" />
    </div>
  ),
});

const MAP_LEGEND = [
  ["Available", "available"],
  ["Occupied", "occupied"],
  ["Reserved", "reserved"],
  ["Maintenance", "maintenance"],
];

const COLORS = {
  free: { fill: "rgba(16, 185, 129, 0.55)", stroke: "#10b981" },
  partial: { fill: "rgba(245, 158, 11, 0.55)", stroke: "#f59e0b" },
  blocked: { fill: "rgba(100, 116, 139, 0.22)", stroke: "rgba(100, 116, 139, 0.55)" },
  chosen: { fill: "rgba(59, 130, 246, 0.7)", stroke: "#3b82f6" },
};
const MAX_UNPLACED = 150;
// How long the satellite map may take to appear before the diagram is shown instead.
const MAP_LOAD_TIMEOUT_MS = 12000;
const MAX_MATCHES = 8;

/**
 * Pick the plot (and tier) for a grave record by clicking it on a schematic
 * minimap drawn from the plots' own positions. Plots that cannot take another
 * record are shown dimmed; partly filled buildings are amber, open plots green.
 * Plots with no map position yet are offered in a searchable list.
 *
 * @param {{
 *   plots: Array, selectedPlotId?: string|number|null, selectedTier?: number|null,
 *   ignoreGraveId?: number|null, onSelect: (choice: { plotId: number, tier: number }) => void,
 *   onClose: () => void,
 * }} props
 */
export default function PlotPickerModal({
  plots,
  selectedPlotId = null,
  selectedTier = null,
  ignoreGraveId = null,
  onSelect,
  onClose,
}) {
  const selectable = useMemo(
    () =>
      new Set(
        plots
          .filter((p) => canAddGrave(p) || (selectedPlotId != null && String(p.id) === String(selectedPlotId)))
          .map((p) => p.id)
      ),
    [plots, selectedPlotId]
  );

  const layout = useMemo(() => layoutMiniMap(plots), [plots]);
  const fit = layout?.viewBox ?? null;
  const [view, setView] = useState(fit);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const [chosenId, setChosenId] = useState(selectedPlotId != null ? String(selectedPlotId) : null);
  const [chosenTier, setChosenTier] = useState(selectedTier ?? null);
  const [hoverId, setHoverId] = useState(null);
  const [query, setQuery] = useState("");

  // Satellite map (the Cemetery Map view) whenever a Google Maps key is set,
  // otherwise the diagram. Google reports a rejected key through this global
  // callback, and we fall back to the diagram rather than show a broken map.
  const hasMapKey = Boolean(getClientGoogleMapsApiKey());
  const [mode, setMode] = useState(() => (getClientGoogleMapsApiKey() ? "map" : "diagram"));
  const [notice, setNotice] = useState("");
  const [mapNote, setMapNote] = useState("");
  useEffect(() => {
    const previous = window.gm_authFailure;
    window.gm_authFailure = () => {
      setMode("diagram");
      setMapNote("Google did not accept the map key for this address, so the diagram is shown instead.");
      if (typeof previous === "function") previous();
    };
    return () => {
      window.gm_authFailure = previous;
    };
  }, []);

  // A map that never appears (slow or blocked network) must not leave a spinner
  // forever: after a while show the diagram and say why.
  useEffect(() => {
    if (mode !== "map") return undefined;
    const timer = setTimeout(() => {
      if (!document.querySelector("#plot-picker-gmap .gm-style")) {
        setMode("diagram");
        setMapNote("The satellite map did not load, so the diagram is shown instead. You can try the Satellite map tab again.");
      }
    }, MAP_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [mode]);

  const svgRef = useRef(null);
  const drag = useRef(null);
  const moved = useRef(false);

  const chosenPlot = useMemo(() => plots.find((p) => String(p.id) === chosenId) || null, [plots, chosenId]);
  const hoverPlot = useMemo(() => plots.find((p) => p.id === hoverId) || null, [plots, hoverId]);
  const chosenTiers = useMemo(() => tierAvailability(chosenPlot, ignoreGraveId), [chosenPlot, ignoreGraveId]);

  // ── search ──
  const q = query.trim().toLowerCase();
  const matchesQuery = useCallback(
    (p) =>
      Boolean(q) &&
      (p.plotNumber?.toLowerCase().includes(q) ||
        (p.graves || []).some((g) => g.deceasedName?.toLowerCase().includes(q))),
    [q]
  );
  const matches = useMemo(() => (q ? plots.filter(matchesQuery).slice(0, MAX_MATCHES) : []), [plots, q, matchesQuery]);
  const unplaced = useMemo(
    () => plots.filter((p) => selectable.has(p.id) && !hasPosition(p) && (!q || matchesQuery(p))),
    [plots, selectable, q, matchesQuery]
  );

  // ── choosing ──
  const choose = useCallback(
    (plot) => {
      if (!selectable.has(plot.id)) return;
      setChosenId(String(plot.id));
      const tiers = tierAvailability(plot, ignoreGraveId);
      const keep =
        String(plot.id) === String(selectedPlotId) && tiers.find((t) => t.tier === selectedTier && !t.occupant);
      const first = keep || tiers.find((t) => !t.occupant);
      setChosenTier(first ? first.tier : null);
    },
    [selectable, ignoreGraveId, selectedPlotId, selectedTier]
  );

  // Plots that cannot take another record are drawn dimmed on the satellite map.
  const blockedIds = useMemo(
    () => new Set(plots.filter((p) => !selectable.has(p.id)).map((p) => p.id)),
    [plots, selectable]
  );

  const handleMapSelect = useCallback(
    (plot) => {
      if (!plot) return;
      if (!selectable.has(plot.id)) {
        setNotice(`${plot.plotNumber} has no vacant tier — choose a plot that is not dimmed.`);
        return;
      }
      setNotice("");
      choose(plot);
    },
    [selectable, choose]
  );

  const canConfirm = Boolean(chosenPlot) && (chosenTiers.length <= 1 || chosenTier != null);
  const confirm = () => {
    if (!canConfirm) return;
    onSelect({ plotId: chosenPlot.id, tier: chosenTiers.length <= 1 ? 1 : chosenTier });
  };

  // ── pan / zoom ──
  const [isDragging, setIsDragging] = useState(false);

  const zoomAround = useCallback(
    (factor, fx, fy) => {
      if (!fit) return;
      setView((v) => zoomView(v, factor, fx, fy, fit, 5.5));
    },
    [fit]
  );

  const zoomCentre = (factor) => {
    const v = viewRef.current;
    if (v) zoomAround(factor, v.x + v.w / 2, v.y + v.h / 2);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (e) => {
      const v = viewRef.current;
      if (!v) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const fx = v.x + ((e.clientX - rect.left) / rect.width) * v.w;
      const fy = v.y + ((e.clientY - rect.top) / rect.height) * v.h;
      // Smooth, clamped zoom step so trackpad gestures don't instantly fly to max zoom
      const delta = Math.max(-80, Math.min(80, e.deltaY));
      const factor = delta < 0 ? Math.max(0.85, 1 + delta * 0.002) : Math.min(1.15, 1 + delta * 0.002);
      zoomAround(factor, fx, fy);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAround, layout]);

  const startDrag = (e) => {
    if (e.button !== 0 || !viewRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, view: viewRef.current, k: viewRef.current.w / rect.width };
    moved.current = false;
    const onMove = (ev) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 10) {
        if (!moved.current) setIsDragging(true);
        moved.current = true;
      }
      if (moved.current) setView(panView(d.view, -dx * d.k, -dy * d.k));
    };
    const onUp = () => {
      drag.current = null;
      setIsDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── close on Escape ──
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // ── drawing helpers ──
  const colorsFor = (plot) => {
    if (String(plot.id) === chosenId) return COLORS.chosen;
    if (!selectable.has(plot.id)) return COLORS.blocked;
    const tiers = tierAvailability(plot, ignoreGraveId);
    return tiers.every((t) => !t.occupant) ? COLORS.free : COLORS.partial;
  };

  const vacancyText = (plot) => {
    if (!plot) return "";
    const tiers = tierAvailability(plot, ignoreGraveId);
    const vacant = tiers.filter((t) => !t.occupant).length;
    if (!selectable.has(plot.id)) return "no vacant tier";
    return tiers.length > 1 ? `${vacant} of ${tiers.length} tiers vacant` : "available";
  };

  const plotWhere = (plot) =>
    [plot?.locationDetail?.location?.name, plot?.locationDetail?.subsection].filter(Boolean).join(" · ");

  const showNumbers = view && fit && view.w < fit.w / 2.5;
  // Building labels scale with the size of the cemetery instead of a fixed size.
  const labelSize = fit ? Math.min(2.4, Math.max(1.2, fit.w / 80)) : 2;

  const modal = (
    <div className="modal-overlay" style={{ zIndex: 10100 }} onClick={onClose} role="presentation">
      <div
        className="modal plot-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a plot"
        onClick={(e) => e.stopPropagation()}
        id="plot-picker"
      >
        <div className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, marginBottom: "0.4rem" }}>
          <h3 className="modal-title" style={{ margin: 0, fontSize: "1.1rem" }}>
            Choose a plot
          </h3>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close plot picker">
            <X size={16} />
          </button>
        </div>

        <div style={{ position: "relative", marginBottom: "0.5rem", flexShrink: 0 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--text-muted)" }} />
          <input
            type="text"
            className="form-input"
            style={{ paddingLeft: 30 }}
            placeholder="Search by plot number or deceased name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            id="plot-picker-search"
          />
        </div>

        {matches.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, maxHeight: 60, overflowY: "auto", flexShrink: 0 }} id="plot-picker-matches">
            {matches.map((p) => {
              const ok = selectable.has(p.id);
              const who = (p.graves || []).map((g) => g.deceasedName).filter(Boolean).join(", ");
              return (
                <button
                  key={p.id}
                  type="button"
                  className="btn btn-ghost"
                  disabled={!ok}
                  title={ok ? vacancyText(p) : "No vacant tier"}
                  onClick={() => choose(p)}
                  style={{ fontSize: "0.75rem", opacity: ok ? 1 : 0.5 }}
                >
                  {p.plotNumber}
                  {who ? ` — ${who}` : ""}
                </button>
              );
            })}
          </div>
        )}

        <div className="plot-picker-body">
          {/* ── Minimap ── */}
          <div style={{ flex: "1 1 520px", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {hasMapKey && (
              <div role="tablist" aria-label="Map view" style={{ display: "flex", gap: 4, marginBottom: 6, flexShrink: 0 }}>
                {[
                  ["map", "Satellite map"],
                  ["diagram", "Diagram"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={mode === key}
                    onClick={() => {
                      setMode(key);
                      if (key === "map") setMapNote("");
                    }}
                    className="btn btn-ghost"
                    id={`plot-picker-mode-${key}`}
                    style={{
                      padding: "3px 10px",
                      fontSize: "0.75rem",
                      border: mode === key ? "1.5px solid #3b82f6" : "1px solid var(--border-default)",
                      background: mode === key ? "rgba(59, 130, 246, 0.15)" : undefined,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {mapNote && mode === "diagram" && (
              <div
                role="status"
                id="plot-picker-map-note"
                style={{
                  marginBottom: 6,
                  padding: "5px 9px",
                  fontSize: "0.75rem",
                  borderRadius: 6,
                  background: "rgba(245, 158, 11, 0.14)",
                  border: "1px solid rgba(245, 158, 11, 0.45)",
                  color: "var(--text-primary)",
                  flexShrink: 0,
                }}
              >
                {mapNote}
              </div>
            )}
            {mode === "map" ? (
              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: 320,
                  width: "100%",
                  border: "1px solid var(--border-default)",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
                id="plot-picker-gmap"
              >
                <CemeteryMapView
                  plots={plots}
                  selectedPlot={chosenPlot}
                  onSelectPlot={handleMapSelect}
                  dimmedPlotIds={blockedIds}
                  fitPlots
                />
              </div>
            ) : layout && view ? (
              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: 220,
                  width: "100%",
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                <svg
                  ref={svgRef}
                  viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ width: "100%", height: "100%", display: "block", cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
                  onPointerDown={startDrag}
                  onDoubleClick={() => {
                    if (fit) setView(fit);
                  }}
                  role="group"
                  aria-label="Cemetery plots"
                  id="plot-picker-map"
                >
                  {layout.groups.map((g) => (
                    <text
                      key={g.key}
                      x={g.cx}
                      y={g.top - labelSize * 1.1}
                      textAnchor="middle"
                      fontSize={labelSize}
                      fontWeight={700}
                      fill="var(--text-secondary)"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {buildingLabel(g.key)}
                    </text>
                  ))}

                  {layout.shapes.map((s) => {
                    const { plot } = s;
                    const ok = selectable.has(plot.id);
                    const c = colorsFor(plot);
                    const isChosen = String(plot.id) === chosenId;
                    const isMatch = matchesQuery(plot);
                    return (
                      <g key={plot.id}>
                        <polygon
                          points={s.points}
                          fill={c.fill}
                          stroke={isMatch ? "#e879f9" : c.stroke}
                          strokeWidth={isChosen || isMatch ? 0.5 : 0.22}
                          style={{ cursor: ok ? "pointer" : "not-allowed" }}
                          role="button"
                          tabIndex={ok ? 0 : -1}
                          aria-disabled={!ok}
                          aria-pressed={isChosen}
                          aria-label={`${plot.plotNumber}, ${vacancyText(plot)}`}
                          data-plot-number={plot.plotNumber}
                          onMouseEnter={() => setHoverId(plot.id)}
                          onMouseLeave={() => setHoverId((h) => (h === plot.id ? null : h))}
                          onFocus={() => setHoverId(plot.id)}
                          onClick={() => {
                            if (moved.current) {
                              moved.current = false;
                              return;
                            }
                            choose(plot);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              choose(plot);
                            }
                          }}
                        />
                        {showNumbers && (
                          <text
                            x={s.cx}
                            y={s.cy + 0.45}
                            textAnchor="middle"
                            fontSize={1.2}
                            fill="var(--text-primary)"
                            style={{ pointerEvents: "none", userSelect: "none" }}
                          >
                            {columnShortLabel(plot.plotNumber)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>

                <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => zoomCentre(0.75)} aria-label="Zoom in" title="Zoom in">
                    <ZoomIn size={15} />
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => zoomCentre(1 / 0.75)} aria-label="Zoom out" title="Zoom out">
                    <ZoomOut size={15} />
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setView(fit)} aria-label="Reset zoom / Show all" title="Reset zoom / Show all (or double-click map)">
                    <Maximize2 size={15} />
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: "2rem 1rem",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  border: "1px dashed var(--border-default)",
                  borderRadius: 10,
                }}
              >
                No plot has a map position yet. Choose from the list below.
              </div>
            )}

            {mode === "map" && (
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: "0.72rem", color: "var(--text-secondary)", flexShrink: 0 }}
                aria-hidden="true"
              >
                {MAP_LEGEND.map(([label, status]) => (
                  <span key={status} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: getPlotStatusColor(status) }} />
                    {label}
                  </span>
                ))}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "#64748b", opacity: 0.35 }} />
                  Dimmed: no vacant tier
                </span>
              </div>
            )}
            <div
              style={{ display: mode === "map" ? "none" : "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: "0.72rem", color: "var(--text-secondary)", flexShrink: 0 }}
              aria-hidden="true"
            >
              {[
                ["Open (all tiers vacant)", COLORS.free],
                ["Partly filled", COLORS.partial],
                ["No vacant tier", COLORS.blocked],
                ["Selected", COLORS.chosen],
              ].map(([label, c]) => (
                <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: c.fill, border: `1px solid ${c.stroke}` }} />
                  {label}
                </span>
              ))}
            </div>

            <div style={{ marginTop: 6, minHeight: 20, fontSize: "0.78rem", color: "var(--text-secondary)", flexShrink: 0 }} id="plot-picker-hover">
              {mode === "map" ? (
                notice || "Click a plot on the map to choose it. Plots drawn dimmed have no vacant tier."
              ) : hoverPlot ? (
                <>
                  <strong style={{ color: "var(--text-primary)" }}>{hoverPlot.plotNumber}</strong>
                  {plotWhere(hoverPlot) ? ` · ${plotWhere(hoverPlot)}` : ""} · {vacancyText(hoverPlot)}
                </>
              ) : (
                "Hover a plot for details, click to choose it. Scroll to zoom, drag to move, double-click to reset zoom."
              )}
            </div>
          </div>

          {/* ── Selection panel ── */}
          <div
            style={{
              flex: "0 0 310px",
              width: 310,
              minWidth: 260,
              maxWidth: 340,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              overflow: "hidden",
            }}
            id="plot-picker-panel"
          >
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              {chosenPlot ? (
                <>
                  <div style={{ fontWeight: 700, fontSize: "0.98rem", color: "var(--text-primary)" }}>{chosenPlot.plotNumber}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: 4 }}>{plotWhere(chosenPlot)}</div>

                  {chosenTiers.length > 1 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 155, overflowY: "auto", scrollbarWidth: "thin" }} role="radiogroup" aria-label="Tier">
                      {[...chosenTiers].reverse().map((t) => (
                        <button
                          key={t.tier}
                          type="button"
                          role="radio"
                          aria-checked={chosenTier === t.tier}
                          disabled={Boolean(t.occupant)}
                          onClick={() => setChosenTier(t.tier)}
                          className="btn btn-ghost"
                          data-tier={t.tier}
                          style={{
                            justifyContent: "flex-start",
                            textAlign: "left",
                            padding: "5px 9px",
                            fontSize: "0.78rem",
                            opacity: t.occupant ? 0.55 : 1,
                            border: chosenTier === t.tier ? "1.5px solid #3b82f6" : "1px solid var(--border-default)",
                            background: chosenTier === t.tier ? "rgba(59, 130, 246, 0.15)" : undefined,
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{t.label}</span>
                          <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                            {t.occupant ? t.occupant.deceasedName : "vacant"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Single-burial lot.</div>
                  )}
                </>
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: "0.82rem", padding: "4px 0" }}>
                  Click a plot on the map to choose it.
                </div>
              )}
            </div>

            {unplaced.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-secondary)", marginBottom: 5, letterSpacing: "0.03em", flexShrink: 0 }}>
                  NOT ON THE MAP ({unplaced.length})
                </div>
                <div
                  id="plot-picker-unplaced"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignContent: "flex-start",
                    gap: 4,
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    paddingRight: 4,
                    scrollbarWidth: "thin",
                  }}
                >
                  {unplaced.slice(0, MAX_UNPLACED).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => choose(p)}
                      style={{
                        fontSize: "0.72rem",
                        padding: "2px 8px",
                        border: String(p.id) === chosenId ? "1.5px solid #3b82f6" : "1px solid var(--border-default)",
                      }}
                    >
                      {p.plotNumber}
                    </button>
                  ))}
                  {unplaced.length > MAX_UNPLACED && (
                    <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", alignSelf: "center", padding: "2px 4px" }}>
                      …{unplaced.length - MAX_UNPLACED} more — use search
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          className="modal-footer"
          style={{
            marginTop: "0.6rem",
            paddingTop: "0.6rem",
            borderTop: "1px solid var(--border-default)",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "0.75rem",
            flexShrink: 0,
          }}
        >
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!canConfirm} onClick={confirm} id="plot-picker-confirm">
            <Check size={15} />{" "}
            {chosenPlot
              ? `Use ${chosenPlot.plotNumber}${
                  chosenTiers.length > 1 && chosenTier
                    ? ` · ${chosenTiers.find((t) => t.tier === chosenTier)?.label ?? `Tier ${chosenTier}`}`
                    : ""
                }`
              : "Choose a plot"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
