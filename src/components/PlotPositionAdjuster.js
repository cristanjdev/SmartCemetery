"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Move,
  RotateCw,
  RotateCcw,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Save,
  Undo2,
  Redo2,
  X,
  Check,
  Layers,
  Sliders,
  BookmarkCheck,
  MapPin,
  HelpCircle,
  PenTool,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Info,
  Compass,
  CheckCircle2,
  AlertCircle,
  Minimize,
  PanelLeft,
  PanelBottom,
  LayoutGrid,
  ArrowLeftRight,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import {
  DEFAULT_BUILDING_LENGTH_M,
  DEFAULT_BUILDING_WIDTH_M,
  DEFAULT_GRID_ANGLE_DEG,
} from "@/lib/config";
import {
  buildingLabel,
  isBuildingPlot,
  listBuildingKeys,
  plotsOfBuilding,
  blockFullLabel,
} from "@/lib/cemetery-layout";
import {
  snapBuildingToPlots,
  getSubdividedBuildingCells,
  applyBuildingCellsToPlots,
} from "../lib/building-grid";
import {
  LAYOUT_DELETED_ROWS,
  LAYOUT_PRESET,
  LAYOUT_PRESET_SUMMARY,
  applyLayoutPreset,
  defaultRowConfig,
} from "../lib/layout-preset";
import { getAdjusterTheme } from "../lib/adjuster-theme";

/**
 * Adjust specific lines/edges of the boundary polygon by deltaMeters
 */
export function adjustBoundaryLine(offsets, line, deltaMeters) {
  if (!Array.isArray(offsets) || offsets.length < 3) return offsets || [];

  // A vertex belongs to a side when it lies in that side's outer quarter of the
  // polygon's extent, so this works for any polygon (rectangle, traced outline…).
  const xs = offsets.map((p) => p.dx);
  const ys = offsets.map((p) => p.dy);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const bandX = (maxX - minX) * 0.25;
  const bandY = (maxY - minY) * 0.25;
  const onSide = {
    north: (p) => p.dy >= maxY - bandY,
    south: (p) => p.dy <= minY + bandY,
    east: (p) => p.dx >= maxX - bandX,
    west: (p) => p.dx <= minX + bandX,
  };

  return offsets.map((pt) => {
    let { dx, dy } = pt;
    if (line === "north" && onSide.north(pt)) {
      dy += deltaMeters;
    } else if (line === "south" && onSide.south(pt)) {
      dy -= deltaMeters;
    } else if (line === "east" && onSide.east(pt)) {
      dx += deltaMeters;
    } else if (line === "west" && onSide.west(pt)) {
      dx -= deltaMeters;
    } else if (line === "expand") {
      dx += dx >= 0 ? deltaMeters : -deltaMeters;
      dy += dy >= 0 ? deltaMeters : -deltaMeters;
    }
    return { dx: Number(dx.toFixed(2)), dy: Number(dy.toFixed(2)) };
  });
}

/**
 * Meters to Degrees conversion utilities for Cagayan de Oro (lat ≈ 8.465)
 */
// Pure geometry helpers moved to src/lib/geo.js. Imported for local use and
// re-exported so existing importers keep working.
import {
  M_TO_LAT,
  mToLng,
  translatePlots,
  rotatePlots,
  scalePlots,
  getPlotsBoundingBox,
} from "../lib/geo";

export {
  M_TO_LAT,
  mToLng,
  translatePlots,
  rotatePlots,
  scalePlots,
  getPlotsBoundingBox,
} from "../lib/geo";


export default function PlotPositionAdjuster({
  active = false,
  onClose,
  plots = [],
  onUpdatePlots,
  onSave,
  onPresetSuccess,
  saving = false,
  selectedScope = "all",
  onSelectScope,
  gridAngle = DEFAULT_GRID_ANGLE_DEG,
  onChangeGridAngle,
  boundaryOffsets = null,
  onUpdateBoundaryOffsets,
  editBoundaryLines = false,
  onToggleEditBoundaryLines,
  onResetBoundary,
  onCancel,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  buildingConfig = null,
  onUpdateBuildingConfig,
  activeTab: controlledTab,
  onTabChange,
  confirmDeleteRow: controlledConfirmDeleteRow,
  onConfirmDeleteRow: controlledOnConfirmDeleteRow,
}) {
  const [stepSize, setStepSize] = useState(0.5); // meters: 0.1, 0.5, 2.0
  const [internalTab, setInternalTab] = useState("plots"); // "plots" | "boundary" | "building"

  // Support both fully-controlled and fully-uncontrolled usage. If a caller
  // passes a controlled value without its change callback, fall back to
  // internal state (with a dev warning) instead of rendering a stuck UI.
  const tabIsControlled = controlledTab !== undefined && typeof onTabChange === "function";
  const activeTab = tabIsControlled ? controlledTab : internalTab;

  const confirmIsControlled =
    controlledConfirmDeleteRow !== undefined &&
    typeof controlledOnConfirmDeleteRow === "function";
  const confirmDeleteRow = confirmIsControlled
    ? controlledConfirmDeleteRow
    : internalConfirmDeleteRow;
  const setConfirmDeleteRow = useCallback(
    (val) => {
      if (typeof controlledOnConfirmDeleteRow === "function") {
        controlledOnConfirmDeleteRow(val);
      }
      setInternalConfirmDeleteRow(val);
    },
    [controlledOnConfirmDeleteRow]
  );

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (controlledTab !== undefined && typeof onTabChange !== "function") {
      console.warn(
        "[PlotPositionAdjuster] `activeTab` was provided without `onTabChange`; falling back to internal tab state."
      );
    }
    if (
      controlledConfirmDeleteRow !== undefined &&
      typeof controlledOnConfirmDeleteRow !== "function"
    ) {
      console.warn(
        "[PlotPositionAdjuster] `confirmDeleteRow` was provided without `onConfirmDeleteRow`; falling back to internal state."
      );
    }
  }, [controlledTab, onTabChange, controlledConfirmDeleteRow, controlledOnConfirmDeleteRow]);

  const handleSetTab = (tab) => {
    if (typeof onTabChange === "function") {
      onTabChange(tab);
    }
    setInternalTab(tab);
    if (typeof onUpdateBuildingConfig === "function") {
      onUpdateBuildingConfig((prev) => ({
        ...prev,
        active: tab === "building",
      }));
    }
  };
  const [showHelp, setShowHelp] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isLight, setIsLight] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);

  useEffect(() => {
    const updateTheme = () => {
      const themeAttr = document.documentElement.getAttribute("data-theme");
      setIsLight(themeAttr === "light");
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Close the delete-confirmation dialog with Escape.
  useEffect(() => {
    if (!confirmDeleteRow) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) setConfirmDeleteRow(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDeleteRow, saving, setConfirmDeleteRow]);

  const t = useMemo(() => getAdjusterTheme(isLight), [isLight]);

  const [panelPosition, setPanelPosition] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("cmp_adjuster_position");
        if (saved === "bottom" || saved === "left") {
          return saved;
        }
      } catch {
        // ignore
      }
    }
    return "left";
  });

  const togglePanelPosition = useCallback(() => {
    setPanelPosition((prev) => {
      const next = prev === "left" ? "bottom" : "left";
      try {
        localStorage.setItem("cmp_adjuster_position", next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const handleLineNudge = useCallback(
    (line, delta) => {
      if (!onUpdateBoundaryOffsets || !Array.isArray(boundaryOffsets) || boundaryOffsets.length < 3) return;
      const updated = adjustBoundaryLine(boundaryOffsets, line, delta);
      onUpdateBoundaryOffsets(updated);
    },
    [boundaryOffsets, onUpdateBoundaryOffsets]
  );

  // Buildings (rows) that exist, from the plots' own data
  const availableRows = useMemo(() => listBuildingKeys(plots), [plots]);

  // Minimum required columns to protect existing plots that have graves
  const minColsForTargetRow = useMemo(() => {
    const targetRow = buildingConfig?.targetRow;
    if (!targetRow || targetRow === "custom") return 1;
    const targetPlots = plotsOfBuilding(plots, targetRow);

    let maxGraveIdx = -1;
    targetPlots.forEach((p, idx) => {
      if (Array.isArray(p.graves) && p.graves.length > 0) {
        maxGraveIdx = Math.max(maxGraveIdx, idx);
      }
    });

    const numRows = Math.max(1, buildingConfig?.numRows || 1);
    if (maxGraveIdx === -1) return 1;
    return Math.ceil((maxGraveIdx + 1) / numRows);
  }, [plots, buildingConfig]);

  const scopeFilter = useCallback(
    (p) => {
      if (p._deleted || !isBuildingPlot(p)) return false;
      return selectedScope === "all" || plotsOfBuilding([p], selectedScope).length === 1;
    },
    [selectedScope]
  );

  const bbox = useMemo(() => getPlotsBoundingBox(plots, scopeFilter), [plots, scopeFilter]);

  const modifiedCount = useMemo(
    () => plots.filter((p) => p._modified && !p._deleted).length,
    [plots]
  );

  // Translate in cardinal directions
  const handleNudge = useCallback(
    (direction) => {
      if (!bbox || typeof onUpdatePlots !== "function") return;
      const latStep = stepSize * M_TO_LAT;
      const lngStep = stepSize * mToLng(bbox.centerLat);

      let dLat = 0;
      let dLng = 0;

      if (direction === "up") dLat = latStep;
      else if (direction === "down") dLat = -latStep;
      else if (direction === "left") dLng = -lngStep;
      else if (direction === "right") dLng = lngStep;

      const updated = translatePlots(plots, dLat, dLng, scopeFilter);
      onUpdatePlots(updated);
    },
    [bbox, stepSize, plots, scopeFilter, onUpdatePlots]
  );

  // Rotate
  const handleRotate = useCallback(
    (deg) => {
      if (!bbox || typeof onUpdatePlots !== "function") return;
      const updated = rotatePlots(plots, bbox.centerLat, bbox.centerLng, deg, scopeFilter);
      onUpdatePlots(updated);
      if (typeof onChangeGridAngle === "function") {
        onChangeGridAngle((prev) => Number((prev + deg).toFixed(1)));
      }
    },
    [bbox, plots, scopeFilter, onUpdatePlots, onChangeGridAngle]
  );

  // Scale / Stretch
  const handleScale = useCallback(
    (factor) => {
      if (!bbox || typeof onUpdatePlots !== "function") return;
      const updated = scalePlots(plots, bbox.centerLat, bbox.centerLng, factor, scopeFilter);
      onUpdatePlots(updated);
    },
    [bbox, plots, scopeFilter, onUpdatePlots]
  );

  // Building block snap to row
  const handleSnapToRow = useCallback(
    (targetRow = buildingConfig?.targetRow) => {
      if (!targetRow || targetRow === "custom") return;
      const targetPlots = plotsOfBuilding(plots, targetRow);
      const snapped = snapBuildingToPlots(targetPlots, gridAngle ?? DEFAULT_GRID_ANGLE_DEG);
      if (snapped && onUpdateBuildingConfig) {
        onUpdateBuildingConfig((prev) => ({
          ...prev,
          ...snapped,
          targetRow,
          active: true,
        }));
      }
    },
    [plots, gridAngle, buildingConfig?.targetRow, onUpdateBuildingConfig]
  );

  // Apply building cell coordinates to database plots
  const handleApplyBuildingPlots = useCallback(async () => {
    if (!buildingConfig || !onUpdatePlots) return;
    const targetPlots = plotsOfBuilding(plots, buildingConfig.targetRow);

    const cells = getSubdividedBuildingCells({
      centerLat: buildingConfig.centerLat,
      centerLng: buildingConfig.centerLng,
      lengthMeters: buildingConfig.lengthMeters,
      widthMeters: buildingConfig.widthMeters,
      angleDeg: buildingConfig.angleDeg,
      numCols: buildingConfig.numCols,
      numRows: buildingConfig.numRows,
      invertCols: buildingConfig.invertCols,
      targetPlots,
      targetRow: buildingConfig.targetRow,
    });

    const updated = applyBuildingCellsToPlots(cells, plots, buildingConfig.targetRow);
    onUpdatePlots(updated);
    if (typeof onSave === "function") {
      await onSave(updated);
    }
  }, [buildingConfig, plots, onUpdatePlots, onSave]);

  // Revise & align every building row at once
  const handleReviseAllRows = useCallback(async () => {
    if (!onUpdatePlots) return;

    let updatedPlots = [...plots];

    for (const r of availableRows) {
      const rowPlots = plotsOfBuilding(plots, r);

      if (rowPlots.length === 0) continue;

      const snapped = snapBuildingToPlots(rowPlots, gridAngle ?? DEFAULT_GRID_ANGLE_DEG);
      if (!snapped) continue;

      const cells = getSubdividedBuildingCells({
        centerLat: snapped.centerLat,
        centerLng: snapped.centerLng,
        lengthMeters: snapped.lengthMeters,
        widthMeters: snapped.widthMeters,
        angleDeg: snapped.angleDeg,
        // Two rows (front and back faces) for a back-to-back block.
        numCols: snapped.numCols,
        numRows: snapped.numRows,
        invertCols: false,
        targetPlots: rowPlots,
        targetRow: r,
      });

      updatedPlots = applyBuildingCellsToPlots(cells, updatedPlots, r);
    }

    onUpdatePlots(updatedPlots);
    if (typeof onSave === "function") {
      await onSave(updatedPlots);
    }
  }, [plots, availableRows, gridAngle, onUpdatePlots, onSave]);

  // Delete an entire building row: unpins occupied plots with graves and permanently deletes empty plots
  const handleDeleteBuilding = useCallback(
    async (rowToDelete) => {
      if (!rowToDelete || !onUpdatePlots) return;
      const targetPlots = plotsOfBuilding(plots, rowToDelete);

      if (targetPlots.length === 0) {
        setConfirmDeleteRow(null);
        return;
      }

      const updated = applyBuildingCellsToPlots([], plots, rowToDelete);
      onUpdatePlots(updated);
      if (typeof onUpdateBuildingConfig === "function") {
        onUpdateBuildingConfig((prev) => ({
          ...prev,
          active: false,
        }));
      }
      setConfirmDeleteRow(null);
      if (typeof onSave === "function") {
        await onSave(updated);
      }
    },
    [plots, onUpdatePlots, onUpdateBuildingConfig, onSave, setConfirmDeleteRow]
  );

  // Apply the configured layout preset (see src/lib/layout-preset.json)
  const handleApplyPreset = useCallback(async () => {
    setApplyingPreset(true);
    try {
      const res = await fetch("/api/plots/preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.plots && data.plots.length > 0) {
          if (typeof onUpdatePlots === "function") {
            onUpdatePlots(data.plots);
          }
          if (typeof onPresetSuccess === "function") {
            onPresetSuccess(data.plots);
          }
          if (typeof onUpdateBuildingConfig === "function") {
            const initialRowCfg = defaultRowConfig();
            if (initialRowCfg) {
              onUpdateBuildingConfig((prev) => ({
                ...prev,
                ...initialRowCfg,
                active: true,
              }));
            }
          }
          setShowPresetModal(false);
          setApplyingPreset(false);
          return;
        }
      }
    } catch (err) {
      console.warn("Server preset failed, falling back to client-side preset:", err);
    }

    // Fallback: client-side preset application
    if (!onUpdatePlots) {
      setApplyingPreset(false);
      setShowPresetModal(false);
      return;
    }
    const updated = applyLayoutPreset(plots);
    onUpdatePlots(updated);
    if (typeof onUpdateBuildingConfig === "function") {
      const initialRowCfg = defaultRowConfig();
      if (initialRowCfg) {
        onUpdateBuildingConfig((prev) => ({
          ...prev,
          ...initialRowCfg,
          active: true,
        }));
      }
    }
    setShowPresetModal(false);
    if (typeof onSave === "function") {
      await onSave(updated);
    }
    if (typeof onPresetSuccess === "function") {
      onPresetSuccess(updated);
    }
    setApplyingPreset(false);
  }, [plots, onUpdatePlots, onUpdateBuildingConfig, onSave, onPresetSuccess]);

  const deleteRowPlots = useMemo(() => {
    if (!confirmDeleteRow) return [];
    return plotsOfBuilding(plots, confirmDeleteRow);
  }, [confirmDeleteRow, plots]);

  const deleteEmptyCount = useMemo(
    () => deleteRowPlots.filter((p) => !p.graves || p.graves.length === 0).length,
    [deleteRowPlots]
  );

  const deleteOccupiedPlots = useMemo(
    () => deleteRowPlots.filter((p) => p.graves && p.graves.length > 0),
    [deleteRowPlots]
  );

  // Nudge building block center
  const handleNudgeBuilding = useCallback(
    (direction) => {
      if (!buildingConfig || !onUpdateBuildingConfig) return;
      let dx = 0;
      let dy = 0;
      if (direction === "up") dy = stepSize;
      if (direction === "down") dy = -stepSize;
      if (direction === "left") dx = -stepSize;
      if (direction === "right") dx = stepSize;

      const latOffset = dy * M_TO_LAT;
      const lngOffset = dx * mToLng(buildingConfig.centerLat);

      onUpdateBuildingConfig((prev) => ({
        ...prev,
        centerLat: Number((prev.centerLat + latOffset).toFixed(8)),
        centerLng: Number((prev.centerLng + lngOffset).toFixed(8)),
      }));
    },
    [buildingConfig, onUpdateBuildingConfig, stepSize]
  );

  const nudgeBtnStyle = useMemo(
    () => ({
      width: 32,
      height: 26,
      background: t.nudgeBtnBg,
      border: t.nudgeBtnBorder,
      borderRadius: 4,
      color: t.nudgeBtnColor,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "background 0.15s ease",
    }),
    [t]
  );

  if (!active) return null;

  const isLeft = panelPosition === "left";

  // Minimized docked view
  if (isMinimized) {
    return (
      <div
        style={{
          position: "absolute",
          top: isLeft ? 16 : undefined,
          bottom: isLeft ? undefined : 20,
          left: isLeft ? 16 : "50%",
          transform: isLeft ? "none" : "translateX(-50%)",
          zIndex: 400,
          background: t.pillBg,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: "var(--radius-full, 9999px)",
          border: t.pillBorder,
          boxShadow: t.pillShadow,
          padding: "6px 14px 6px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          animation: "fadeSlideIn 0.2s ease-out",
          color: t.pillText,
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 600 }}>
          <Compass size={15} style={{ color: isLight ? "#0284c7" : "#38bdf8" }} />
          <span>Alignment Active</span>
          <span style={{ color: t.textMuted }}>•</span>
          <span style={{ color: isLight ? "#0284c7" : "#38bdf8", fontSize: "0.78rem", fontFamily: "var(--font-mono)" }}>
            {(gridAngle ?? DEFAULT_GRID_ANGLE_DEG).toFixed(1)}°
          </span>
          {modifiedCount > 0 ? (
            <span
              style={{
                fontSize: "0.68rem",
                padding: "1px 6px",
                borderRadius: 4,
                background: t.pendingBg,
                color: t.pendingColor,
                fontWeight: 700,
                border: t.pendingBorder,
              }}
            >
              {modifiedCount}
            </span>
          ) : (
            <span
              style={{
                fontSize: "0.68rem",
                padding: "1px 6px",
                borderRadius: 4,
                background: t.alignedBg,
                color: t.alignedColor,
                fontWeight: 600,
              }}
            >
              Sync
            </span>
          )}
        </div>

        <div style={{ width: 1, height: 16, background: isLight ? "#cbd5e1" : "rgba(255, 255, 255, 0.15)" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            style={{
              height: 26,
              padding: "0 10px",
              fontSize: "0.72rem",
              fontWeight: 600,
              borderRadius: "var(--radius-full, 9999px)",
              background: t.pillBtnBg,
              color: t.pillBtnColor,
              border: t.pillBtnBorder,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "all 0.15s ease",
            }}
          >
            <Maximize2 size={12} style={{ color: isLight ? "#0284c7" : "#38bdf8" }} />
            <span style={{ color: t.pillBtnColor }}>Expand</span>
          </button>
          {modifiedCount > 0 && (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              style={{
                height: 26,
                padding: "0 10px",
                fontSize: "0.72rem",
                fontWeight: 600,
                borderRadius: "var(--radius-full, 9999px)",
                background: "#10b981",
                color: "#ffffff",
                border: "1px solid #059669",
                cursor: saving ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                boxShadow: "0 2px 6px rgba(16, 185, 129, 0.35)",
                transition: "all 0.15s ease",
              }}
            >
              <Save size={12} style={{ color: "#ffffff" }} />
              <span style={{ color: "#ffffff" }}>{saving ? "Saving..." : "Save"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={modifiedCount > 0 && onCancel ? onCancel : onClose}
            style={{
              height: 26,
              padding: "0 9px",
              fontSize: "0.72rem",
              fontWeight: 600,
              borderRadius: "var(--radius-full, 9999px)",
              background: modifiedCount > 0 ? (isLight ? "rgba(239, 68, 68, 0.12)" : "rgba(239, 68, 68, 0.2)") : t.pillBtnBg,
              color: modifiedCount > 0 ? (isLight ? "#dc2626" : "#fca5a5") : t.pillBtnColor,
              border: modifiedCount > 0 ? (isLight ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(239, 68, 68, 0.45)") : t.pillBtnBorder,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "all 0.15s ease",
            }}
          >
            {modifiedCount > 0 ? <X size={12} style={{ color: isLight ? "#dc2626" : "#fca5a5" }} /> : null}
            <span style={{ color: modifiedCount > 0 ? (isLight ? "#dc2626" : "#fca5a5") : t.pillBtnColor }}>
              {modifiedCount > 0 ? "Cancel" : "Done"}
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        top: isLeft ? 16 : undefined,
        bottom: isLeft ? 16 : 20,
        left: isLeft ? 16 : "50%",
        transform: isLeft ? "none" : "translateX(-50%)",
        height: isLeft ? "calc(100% - 32px)" : undefined,
        maxHeight: isLeft ? "calc(100% - 32px)" : "calc(100% - 40px)",
        zIndex: 400,
        width: isLeft ? "min(440px, calc(100vw - 32px))" : "min(94%, 820px)",
        background: t.panelBg,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderRadius: "var(--radius-lg, 12px)",
        border: t.panelBorder,
        boxShadow: t.panelShadow,
        color: t.textPrimary,
        padding: isLeft ? "14px 16px" : "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: isLeft ? 10 : 12,
        overflowY: showHelp ? "auto" : isLeft ? "hidden" : "auto",
        scrollbarWidth: "thin",
        animation: "fadeSlideIn 0.2s ease-out",
      }}
    >
      {/* ─── Formal Header ─── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Row 1: Title & Actions Toolbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <Compass size={18} style={{ color: isLight ? "#0284c7" : "#38bdf8", flexShrink: 0 }} />
            <span
              style={{
                fontSize: "0.88rem",
                fontWeight: 700,
                color: t.textPrimary,
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Grid Alignment
            </span>
          </div>

          {/* Top Right Actions Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setShowHelp((prev) => !prev)}
              title={showHelp ? "Hide alignment guide" : "Show alignment guide"}
              style={{
                background: showHelp ? t.btnHeaderGuideActiveBg : t.btnHeaderBg,
                border: showHelp ? t.btnHeaderGuideActiveBorder : t.btnHeaderBorder,
                color: showHelp ? t.btnHeaderGuideActiveColor : t.btnHeaderColor,
                borderRadius: 6,
                height: 26,
                padding: "0 7px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: "0.7rem",
                fontWeight: 600,
                transition: "all 0.15s ease",
              }}
            >
              <HelpCircle size={13} />
              <span className="cmp-guide-text">Guide</span>
            </button>

            {/* Master Preset Button */}
            <button
              type="button"
              onClick={() => setShowPresetModal(true)}
              title={`Apply the ${LAYOUT_PRESET_SUMMARY.name} layout preset (${LAYOUT_PRESET_SUMMARY.totalPlots} plots)`}
              style={{
                background: isLight ? "rgba(16, 185, 129, 0.1)" : "rgba(16, 185, 129, 0.18)",
                border: isLight ? "1px solid rgba(16, 185, 129, 0.35)" : "1px solid rgba(16, 185, 129, 0.45)",
                color: isLight ? "#059669" : "#34d399",
                borderRadius: 6,
                padding: "0 8px",
                height: 26,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: "0.69rem",
                fontWeight: 700,
                transition: "all 0.15s ease",
              }}
            >
              <BookmarkCheck size={13} />
              <span>Preset</span>
            </button>

            {/* Position Toggle Button: Left vs Bottom */}
            <button
              type="button"
              onClick={togglePanelPosition}
              title={isLeft ? "Dock panel to bottom" : "Dock panel to left side"}
              aria-label={isLeft ? "Dock panel to bottom" : "Dock panel to left side"}
              style={{
                background: t.btnHeaderBg,
                border: t.btnHeaderBorder,
                color: t.btnHeaderColor,
                borderRadius: 6,
                width: 26,
                height: 26,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s ease",
              }}
            >
              {isLeft ? <PanelBottom size={13} /> : <PanelLeft size={13} />}
            </button>

            <button
              type="button"
              onClick={() => setIsMinimized(true)}
              title="Minimize alignment deck"
              aria-label="Minimize alignment deck"
              style={{
                background: t.btnHeaderBg,
                border: t.btnHeaderBorder,
                color: t.btnHeaderColor,
                borderRadius: 6,
                width: 26,
                height: 26,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s ease",
              }}
            >
              <Minimize size={13} />
            </button>

            <button
              type="button"
              onClick={onClose}
              title="Close alignment deck"
              aria-label="Close alignment deck"
              style={{
                background: t.btnHeaderBg,
                border: t.btnHeaderBorder,
                color: t.btnHeaderColor,
                borderRadius: 6,
                width: 26,
                height: 26,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s ease",
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Row 2: Status & Subtitle Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            minWidth: 0,
            fontSize: "0.72rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {modifiedCount > 0 ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: "0.66rem",
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: t.pendingBg,
                  color: t.pendingColor,
                  border: t.pendingBorder,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                {modifiedCount} Pending
              </span>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: "0.66rem",
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: t.alignedBg,
                  color: t.alignedColor,
                  border: t.alignedBorder,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                Aligned
              </span>
            )}
          </div>

          <span
            style={{
              fontSize: "0.71rem",
              color: t.textMuted,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
              textAlign: "right",
            }}
          >
            Calibrate GPS coordinates & perimeter
          </span>
        </div>
      </div>

      {/* ─── Toolbar: Mode Tabs & Target Scope ─── */}
      <div
        style={{
          display: "flex",
          flexDirection: isLeft ? "column" : "row",
          alignItems: isLeft ? "stretch" : "center",
          justifyContent: isLeft ? "flex-start" : "space-between",
          flexWrap: "wrap",
          gap: 6,
          padding: 0,
        }}
      >
        {/* Segmented Mode Tabs */}
        <div
          style={{
            display: isLeft ? "grid" : "flex",
            gridTemplateColumns: isLeft ? "repeat(3, 1fr)" : undefined,
            background: t.tabTrackBg,
            padding: 3,
            borderRadius: 7,
            border: t.tabTrackBorder,
            width: isLeft ? "100%" : "auto",
            gap: 3,
          }}
        >
          <button
            type="button"
            onClick={() => handleSetTab("plots")}
            title="Plot Coordinates"
            style={{
              justifyContent: "center",
              padding: "5px 4px",
              fontSize: "0.71rem",
              fontWeight: 600,
              borderRadius: 5,
              border: activeTab === "plots" ? t.tabActiveBorder : "1px solid transparent",
              background: activeTab === "plots" ? t.tabActiveBg : "transparent",
              color: activeTab === "plots" ? t.tabActiveColor : t.tabInactiveColor,
              boxShadow: activeTab === "plots" && isLight ? "0 1px 3px rgba(0, 0, 0, 0.08)" : "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              minWidth: 0,
              transition: "all 0.15s ease",
            }}
          >
            <Move size={12} style={{ color: activeTab === "plots" ? (isLight ? "#0284c7" : "#38bdf8") : "inherit", flexShrink: 0 }} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Plot Coordinates</span>
          </button>
          <button
            type="button"
            onClick={() => handleSetTab("boundary")}
            title="Perimeter Boundary"
            style={{
              justifyContent: "center",
              padding: "5px 4px",
              fontSize: "0.71rem",
              fontWeight: 600,
              borderRadius: 5,
              border: activeTab === "boundary" ? t.tabActiveBorder : "1px solid transparent",
              background: activeTab === "boundary" ? t.tabActiveBg : "transparent",
              color: activeTab === "boundary" ? t.tabActiveColor : t.tabInactiveColor,
              boxShadow: activeTab === "boundary" && isLight ? "0 1px 3px rgba(0, 0, 0, 0.08)" : "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              minWidth: 0,
              transition: "all 0.15s ease",
            }}
          >
            <Sliders size={12} style={{ color: activeTab === "boundary" ? (isLight ? "#0284c7" : "#00E5FF") : "inherit", flexShrink: 0 }} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Perimeter Boundary</span>
          </button>
          <button
            type="button"
            onClick={() => handleSetTab("building")}
            title="Building Block"
            style={{
              justifyContent: "center",
              padding: "5px 4px",
              fontSize: "0.71rem",
              fontWeight: 600,
              borderRadius: 5,
              border: activeTab === "building" ? t.tabActiveBorder : "1px solid transparent",
              background: activeTab === "building" ? t.tabActiveBg : "transparent",
              color: activeTab === "building" ? t.tabActiveColor : t.tabInactiveColor,
              boxShadow: activeTab === "building" && isLight ? "0 1px 3px rgba(0, 0, 0, 0.08)" : "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              minWidth: 0,
              transition: "all 0.15s ease",
            }}
          >
            <LayoutGrid size={12} style={{ color: activeTab === "building" ? (isLight ? "#059669" : "#34d399") : "inherit", flexShrink: 0 }} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Building Block</span>
          </button>
        </div>

        {/* Target Scope Dropdown */}
        <div style={{ display: "flex", flexDirection: isLeft ? "column" : "row", alignItems: isLeft ? "flex-start" : "center", gap: isLeft ? 3 : 8, width: isLeft ? "100%" : "auto" }}>
          <label htmlFor="adjuster-scope-select" style={{ fontSize: "0.64rem", fontWeight: 700, color: t.textMuted, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Target Layer:
          </label>
          <select
            id="adjuster-scope-select"
            value={selectedScope}
            onChange={(e) => typeof onSelectScope === "function" && onSelectScope(e.target.value)}
            style={{
              background: t.selectBg,
              color: t.selectColor,
              border: t.selectBorder,
              borderRadius: 5,
              padding: "5px 9px",
              fontSize: "0.74rem",
              fontWeight: 600,
              outline: "none",
              cursor: "pointer",
              width: isLeft ? "100%" : "auto",
              minWidth: isLeft ? "auto" : 260,
            }}
          >
            <option value="all">
              Entire Cemetery Grid ({plots.filter((p) => !p._deleted && isBuildingPlot(p)).length} plots)
            </option>
            <optgroup label="Individual Rows">
              {availableRows.map((r) => (
                <option key={r} value={r}>
                  {blockFullLabel(r)}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {activeTab === "plots" && (
        /* ─── Plot Coordinates Control Deck ─── */
        <div
          style={{
            flex: isLeft ? 1 : undefined,
            minHeight: 0,
            display: isLeft ? "flex" : "grid",
            flexDirection: isLeft ? "column" : undefined,
            justifyContent: isLeft ? "space-between" : undefined,
            gridTemplateColumns: isLeft ? undefined : "auto 1fr 140px",
            gap: isLeft ? 10 : 14,
            alignItems: isLeft ? "stretch" : "center",
            background: t.deckBg,
            padding: isLeft ? "12px 14px" : "10px 14px",
            borderRadius: 8,
            border: t.deckBorder,
          }}
        >
          {/* Section 1: Directional Compass Nudge with Undo/Restore flanking */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: isLeft ? "space-between" : "center",
              gap: isLeft ? 8 : 10,
              width: isLeft ? "100%" : "auto",
            }}
          >
            {/* Undo Button */}
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo last movement (Ctrl+Z)"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                width: 62,
                height: 70,
                borderRadius: 6,
                background: canUndo ? t.undoActiveBg : t.undoInactiveBg,
                border: canUndo ? t.undoActiveBorder : t.undoInactiveBorder,
                color: canUndo ? t.undoActiveColor : t.undoInactiveColor,
                cursor: canUndo ? "pointer" : "not-allowed",
                boxShadow: canUndo && isLight ? "0 1px 3px rgba(0, 0, 0, 0.08)" : canUndo ? "0 2px 8px rgba(0, 0, 0, 0.2)" : "none",
                transition: "all 0.15s ease",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              <Undo2 size={16} />
              <span style={{ fontSize: "0.72rem", fontWeight: 700 }}>Undo</span>
              <kbd
                style={{
                  fontSize: "0.56rem",
                  color: canUndo ? t.textMuted : t.undoInactiveColor,
                  background: t.kbdBg,
                  padding: "1px 4px",
                  borderRadius: 3,
                }}
              >
                Ctrl+Z
              </kbd>
            </button>

            {/* Center: Directional Compass Nudge */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <span style={{ fontSize: "0.62rem", fontWeight: 700, color: t.textMuted, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 1 }}>
                Nudge
              </span>
              <button
                type="button"
                onClick={() => handleNudge("up")}
                title={`Nudge North (+latitude) by ${stepSize}m`}
                aria-label="Nudge North"
                style={nudgeBtnStyle}
              >
                <ChevronUp size={16} />
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <button
                  type="button"
                  onClick={() => handleNudge("left")}
                  title={`Nudge West (-longitude) by ${stepSize}m`}
                  aria-label="Nudge West"
                  style={nudgeBtnStyle}
                >
                  <ChevronLeft size={16} />
                </button>
                <div
                  style={{
                    width: 32,
                    height: 26,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    background: t.nudgeCenterBg,
                    borderRadius: 4,
                    border: t.nudgeCenterBorder,
                  }}
                >
                  <Crosshair size={12} style={{ color: isLight ? "#0284c7" : "#38bdf8" }} />
                  <span style={{ fontSize: "0.58rem", color: t.textMuted, fontWeight: 700 }}>{stepSize}m</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleNudge("right")}
                  title={`Nudge East (+longitude) by ${stepSize}m`}
                  aria-label="Nudge East"
                  style={nudgeBtnStyle}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleNudge("down")}
                title={`Nudge South (-latitude) by ${stepSize}m`}
                aria-label="Nudge South"
                style={nudgeBtnStyle}
              >
                <ChevronDown size={16} />
              </button>
            </div>

            {/* Restore / Redo Button */}
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Restore / Redo undone movement (Ctrl+Y)"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                width: 62,
                height: 70,
                borderRadius: 6,
                background: canRedo ? t.undoActiveBg : t.undoInactiveBg,
                border: canRedo ? t.undoActiveBorder : t.undoInactiveBorder,
                color: canRedo ? t.undoActiveColor : t.undoInactiveColor,
                cursor: canRedo ? "pointer" : "not-allowed",
                boxShadow: canRedo && isLight ? "0 1px 3px rgba(0, 0, 0, 0.08)" : canRedo ? "0 2px 8px rgba(0, 0, 0, 0.2)" : "none",
                transition: "all 0.15s ease",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              <Redo2 size={16} />
              <span style={{ fontSize: "0.72rem", fontWeight: 700 }}>Restore</span>
              <kbd
                style={{
                  fontSize: "0.56rem",
                  color: canRedo ? t.textMuted : t.undoInactiveColor,
                  background: t.kbdBg,
                  padding: "1px 4px",
                  borderRadius: 3,
                }}
              >
                Ctrl+Y
              </kbd>
            </button>
          </div>

          {/* Section 2: Parameters (Step Resolution, Rotation, Spacing) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {/* Step Resolution */}
            <div style={{ display: "flex", flexDirection: isLeft ? "column" : "row", alignItems: isLeft ? "stretch" : "center", gap: isLeft ? 3 : 8 }}>
              <span style={{ fontSize: "0.64rem", fontWeight: 700, color: t.textMuted, letterSpacing: "0.05em", textTransform: "uppercase", minWidth: isLeft ? "auto" : 80 }}>
                Step Size:
              </span>
              <div style={{ display: "flex", gap: 4, width: isLeft ? "100%" : "auto" }}>
                {[
                  { val: 0.1, label: "0.1m", desc: "Micro" },
                  { val: 0.5, label: "0.5m", desc: "Std" },
                  { val: 2.0, label: "2.0m", desc: "Coarse" },
                ].map((s) => (
                  <button
                    key={s.val}
                    type="button"
                    onClick={() => setStepSize(s.val)}
                    title={`Step size: ${s.label} (${s.desc === "Std" ? "Standard" : s.desc})`}
                    style={{
                      flex: isLeft ? 1 : undefined,
                      justifyContent: "center",
                      padding: "4px 6px",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      borderRadius: 4,
                      border: stepSize === s.val ? t.stepActiveBorder : t.stepInactiveBorder,
                      background: stepSize === s.val ? t.stepActiveBg : t.stepInactiveBg,
                      color: stepSize === s.val ? t.stepActiveColor : t.stepInactiveColor,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ whiteSpace: "nowrap" }}>{s.label}</span>
                    <span style={{ fontSize: "0.6rem", opacity: 0.75, whiteSpace: "nowrap" }}>({s.desc})</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Rotation Stepper */}
            <div style={{ display: "flex", flexDirection: isLeft ? "column" : "row", alignItems: isLeft ? "stretch" : "center", gap: isLeft ? 3 : 6 }}>
              <span style={{ fontSize: "0.64rem", fontWeight: 700, color: t.textMuted, letterSpacing: "0.05em", textTransform: "uppercase", minWidth: isLeft ? "auto" : 80 }}>
                Rotation:
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 2, background: t.rotBoxBg, border: t.rotBoxBorder, borderRadius: 5, padding: "2px", width: isLeft ? "100%" : "auto" }}>
                <button
                  type="button"
                  onClick={() => handleRotate(-0.5)}
                  title="Rotate counter-clockwise 0.5°"
                  style={{
                    flex: isLeft ? 1 : undefined,
                    justifyContent: "center",
                    padding: "3px 8px",
                    fontSize: "0.72rem",
                    background: t.rotBtnBg,
                    border: "none",
                    borderRadius: 4,
                    color: t.rotBtnColor,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    whiteSpace: "nowrap",
                  }}
                >
                  <RotateCcw size={12} />
                  <span style={{ whiteSpace: "nowrap" }}>-0.5°</span>
                </button>
                <span style={{ minWidth: 50, textAlign: "center", fontSize: "0.8rem", color: t.rotTextColor, fontWeight: 700, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                  {(gridAngle ?? DEFAULT_GRID_ANGLE_DEG).toFixed(1)}°
                </span>
                <button
                  type="button"
                  onClick={() => handleRotate(0.5)}
                  title="Rotate clockwise 0.5°"
                  style={{
                    flex: isLeft ? 1 : undefined,
                    justifyContent: "center",
                    padding: "3px 8px",
                    fontSize: "0.72rem",
                    background: t.rotBtnBg,
                    border: "none",
                    borderRadius: 4,
                    color: t.rotBtnColor,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    whiteSpace: "nowrap",
                  }}
                >
                  <RotateCw size={12} />
                  <span style={{ whiteSpace: "nowrap" }}>+0.5°</span>
                </button>
              </div>
            </div>

            {/* Density Spacing */}
            <div style={{ display: "flex", flexDirection: isLeft ? "column" : "row", alignItems: isLeft ? "stretch" : "center", gap: isLeft ? 3 : 6 }}>
              <span style={{ fontSize: "0.64rem", fontWeight: 700, color: t.textMuted, letterSpacing: "0.05em", textTransform: "uppercase", minWidth: isLeft ? "auto" : 80 }}>
                Spacing:
              </span>
              <div style={{ display: "flex", gap: 4, width: isLeft ? "100%" : "auto" }}>
                <button
                  type="button"
                  onClick={() => handleScale(0.98)}
                  title="Contract plots inward (-2%)"
                  style={{
                    flex: isLeft ? 1 : undefined,
                    justifyContent: "center",
                    padding: "4px 8px",
                    fontSize: "0.72rem",
                    background: t.spacingBtnBg,
                    border: t.spacingBtnBorder,
                    borderRadius: 4,
                    color: t.spacingBtnColor,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Minimize2 size={12} />
                  <span style={{ whiteSpace: "nowrap" }}>Contract</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleScale(1.02)}
                  title="Expand plots outward (+2%)"
                  style={{
                    flex: isLeft ? 1 : undefined,
                    justifyContent: "center",
                    padding: "4px 8px",
                    fontSize: "0.72rem",
                    background: t.spacingBtnBg,
                    border: t.spacingBtnBorder,
                    borderRadius: 4,
                    color: t.spacingBtnColor,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Maximize2 size={12} />
                  <span style={{ whiteSpace: "nowrap" }}>Expand</span>
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Actions & Commit */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: isLeft ? "100%" : "auto" }}>
            {/* Commit buttons: Save & Cancel */}
            <div style={{ display: "flex", flexDirection: isLeft ? "row" : "column", gap: 6, width: "100%" }}>
              {modifiedCount > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={saving}
                    style={{
                      flex: isLeft ? 1 : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      padding: "7px 12px",
                      background: "#10b981",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 6,
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      cursor: saving ? "default" : "pointer",
                      boxShadow: "0 4px 14px rgba(16, 185, 129, 0.35)",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <Save size={14} />
                    <span>{saving ? "Saving..." : `Save (${modifiedCount})`}</span>
                  </button>

                  <button
                    type="button"
                    onClick={onCancel || onClose}
                    disabled={saving}
                    title="Close editing mode and discard all changes"
                    style={{
                      flex: isLeft ? 1 : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: "7px 12px",
                      background: isLight ? "rgba(239, 68, 68, 0.08)" : "rgba(239, 68, 68, 0.12)",
                      color: isLight ? "#dc2626" : "#f87171",
                      border: isLight ? "1px solid rgba(239, 68, 68, 0.25)" : "1px solid rgba(239, 68, 68, 0.3)",
                      borderRadius: 6,
                      fontSize: "0.76rem",
                      cursor: "pointer",
                      fontWeight: 600,
                      textAlign: "center",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <X size={13} />
                    <span>Cancel</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    width: "100%",
                    padding: "7px 14px",
                    background: t.doneBtnBg,
                    color: t.doneBtnColor,
                    border: t.doneBtnBorder,
                    borderRadius: 6,
                    fontSize: "0.78rem",
                    cursor: "pointer",
                    fontWeight: 700,
                    textAlign: "center",
                    transition: "all 0.15s ease",
                  }}
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "boundary" && (
        /* ─── Boundary Perimeter Control Deck ─── */
        <div
          style={{
            flex: isLeft ? 1 : undefined,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: isLeft ? "space-between" : undefined,
            gap: 10,
            background: t.deckBg,
            padding: isLeft ? "12px 14px" : "12px",
            borderRadius: 8,
            border: t.deckBoundaryBorder,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Top row: Interactive Map Toggle & Uniform Scale */}
            <div style={{ display: "flex", flexDirection: isLeft ? "column" : "row", alignItems: isLeft ? "stretch" : "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <button
                type="button"
                onClick={onToggleEditBoundaryLines}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  padding: "6px 12px",
                  borderRadius: 5,
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  background: editBoundaryLines ? t.boundaryHandleActiveBg : t.boundaryHandleInactiveBg,
                  color: editBoundaryLines ? t.boundaryHandleActiveColor : t.boundaryHandleInactiveColor,
                  border: editBoundaryLines ? t.boundaryHandleActiveBorder : t.boundaryHandleInactiveBorder,
                  boxShadow: editBoundaryLines ? (isLight ? "0 2px 10px rgba(2, 132, 199, 0.25)" : "0 0 14px rgba(0, 229, 255, 0.35)") : "none",
                  transition: "all 0.15s ease",
                }}
              >
                <PenTool size={13} />
                <span>{editBoundaryLines ? "Interactive Handles Active" : "Enable Map Handles"}</span>
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: isLeft ? "space-between" : "flex-end" }}>
                <button
                  type="button"
                  onClick={() => handleLineNudge("expand", 1)}
                  title="Expand boundary 1m on all edges"
                  style={{
                    flex: isLeft ? 1 : undefined,
                    padding: "4px 8px",
                    fontSize: "0.72rem",
                    background: t.boundaryBtnBg,
                    border: t.boundaryBtnBorder,
                    borderRadius: 4,
                    color: isLight ? "#0284c7" : "#38bdf8",
                    cursor: "pointer",
                    fontWeight: 600,
                    textAlign: "center",
                  }}
                >
                  +1 m All
                </button>
                <button
                  type="button"
                  onClick={() => handleLineNudge("expand", -1)}
                  title="Contract boundary 1m on all edges"
                  style={{
                    flex: isLeft ? 1 : undefined,
                    padding: "4px 8px",
                    fontSize: "0.72rem",
                    background: t.boundaryBtnBg,
                    border: t.boundaryBtnBorder,
                    borderRadius: 4,
                    color: t.textSecondary,
                    cursor: "pointer",
                    fontWeight: 600,
                    textAlign: "center",
                  }}
                >
                  -1 m All
                </button>
                <button
                  type="button"
                  onClick={onResetBoundary}
                  title="Reset boundary perimeter to defaults"
                  style={{
                    flex: isLeft ? 1 : undefined,
                    padding: "4px 8px",
                    fontSize: "0.72rem",
                    background: t.boundaryBtnBg,
                    border: t.boundaryBtnBorder,
                    borderRadius: 4,
                    color: isLight ? "#d97706" : "#f59e0b",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 3,
                    fontWeight: 600,
                  }}
                >
                  <Undo2 size={11} />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            {/* 4 Directional Edge Cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isLeft ? "1fr 1fr" : "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 6,
                paddingTop: 2,
              }}
            >
              {[
                { id: "north", label: "North Edge", sub: "Upper", icon: ArrowUp },
                { id: "south", label: "South Edge", sub: "Lower", icon: ArrowDown },
                { id: "east", label: "East Edge", sub: "Road", icon: ArrowRight },
                { id: "west", label: "West Edge", sub: "Driveway", icon: ArrowLeft },
              ].map((edge) => {
                const Icon = edge.icon;
                return (
                  <div
                    key={edge.id}
                    style={{
                      background: t.edgeCardBg,
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: t.edgeCardBorder,
                      boxShadow: isLight ? "0 1px 3px rgba(0,0,0,0.05)" : "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon size={12} style={{ color: isLight ? "#0284c7" : "#38bdf8" }} />
                      <span style={{ fontSize: "0.74rem", fontWeight: 700, color: t.edgeCardText }}>{edge.label}</span>
                    </div>
                    <span style={{ fontSize: "0.62rem", color: t.edgeCardSub }}>{edge.sub}</span>
                    <div style={{ display: "flex", gap: 3 }}>
                      <button
                        type="button"
                        onClick={() => handleLineNudge(edge.id, 1)}
                        title={`Expand ${edge.label} +1m`}
                        style={{
                          flex: 1,
                          padding: "4px 0",
                          fontSize: "0.7rem",
                          background: t.edgeCardBtnBg,
                          border: t.edgeCardBtnBorder,
                          color: isLight ? "#0284c7" : "#38bdf8",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        +1m
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLineNudge(edge.id, 5)}
                        title={`Expand ${edge.label} +5m`}
                        style={{
                          flex: 1,
                          padding: "4px 0",
                          fontSize: "0.7rem",
                          background: t.edgeCardBtnBg,
                          border: t.edgeCardBtnBorder,
                          color: isLight ? "#0284c7" : "#38bdf8",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        +5m
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLineNudge(edge.id, -1)}
                        title={`Contract ${edge.label} -1m`}
                        style={{
                          flex: 1,
                          padding: "4px 0",
                          fontSize: "0.7rem",
                          background: t.edgeCardBtnBg,
                          border: t.edgeCardBtnBorder,
                          color: t.edgeCardSub,
                          borderRadius: 4,
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        -1m
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Action Button (Done) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: "100%",
                padding: "8px 14px",
                background: t.doneBtnBg,
                color: t.doneBtnColor,
                border: t.doneBtnBorder,
                borderRadius: 6,
                fontSize: "0.78rem",
                cursor: "pointer",
                fontWeight: 700,
                textAlign: "center",
                transition: "all 0.15s ease",
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {activeTab === "building" && (
        /* ─── Building Block / Row Generator Deck ─── */
        <div
          style={{
            flex: isLeft ? 1 : undefined,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: isLeft ? "space-between" : undefined,
            gap: isLeft ? 8 : 10,
            background: t.deckBg,
            padding: isLeft ? "12px 14px" : "12px 16px",
            borderRadius: 8,
            border: t.deckBorder,
            overflowY: "auto",
            scrollbarWidth: "thin",
          }}
        >
          {/* Card 1: Target Row & Auto Snap */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.03)",
              padding: "8px 10px",
              borderRadius: 6,
              border: t.deckBorder,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "0.66rem", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>
                Target Building / Row
              </span>
              <button
                type="button"
                onClick={() => handleSnapToRow(buildingConfig?.targetRow || availableRows[0] || "custom")}
                title="Auto-detect and snap building box to current row plots"
                style={{
                  background: isLight ? "rgba(5, 150, 105, 0.1)" : "rgba(16, 185, 129, 0.15)",
                  border: isLight ? "1px solid rgba(5, 150, 105, 0.3)" : "1px solid rgba(16, 185, 129, 0.4)",
                  color: isLight ? "#059669" : "#34d399",
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontSize: "0.68rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Compass size={12} /> Snap to Row
              </button>
            </div>

            <select
              aria-label="Building row"
              value={buildingConfig?.targetRow || availableRows[0] || "custom"}
              onChange={(e) => {
                const row = e.target.value;
                if (typeof onUpdateBuildingConfig === "function") {
                  onUpdateBuildingConfig((prev) => ({
                    ...prev,
                    targetRow: row,
                  }));
                }
                handleSnapToRow(row);
              }}
              style={{
                background: t.selectBg,
                color: t.selectColor,
                border: t.selectBorder,
                borderRadius: 5,
                padding: "5px 8px",
                fontSize: "0.75rem",
                fontWeight: 600,
                outline: "none",
                cursor: "pointer",
                width: "100%",
              }}
            >
              <optgroup label="Apartment Rows">
                {availableRows.map((r) => {
                  const count = plotsOfBuilding(plots, r).length;
                  return (
                    <option key={r} value={r}>
                      {blockFullLabel(r)} ({count} plots)
                    </option>
                  );
                })}
              </optgroup>
              <option value="custom">Custom / New Freeform Block</option>
            </select>

            <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
              <button
                type="button"
                onClick={handleReviseAllRows}
                title="Revise and snap all 15 apartment buildings to straight roof centerlines"
                style={{
                  flex: 1,
                  background: isLight ? "rgba(37, 99, 235, 0.08)" : "rgba(59, 130, 246, 0.15)",
                  border: isLight ? "1px solid rgba(37, 99, 235, 0.25)" : "1px solid rgba(59, 130, 246, 0.35)",
                  color: isLight ? "#1d4ed8" : "#60a5fa",
                  borderRadius: 5,
                  padding: "6px 8px",
                  fontSize: "0.71rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <Layers size={12} /> Align All Rows
              </button>

              <button
                type="button"
                onClick={() => setConfirmDeleteRow(buildingConfig?.targetRow || availableRows[0] || "custom")}
                disabled={!buildingConfig?.targetRow || buildingConfig.targetRow === "custom"}
                title="Delete this entire building from the map and database"
                style={{
                  background: isLight ? "rgba(239, 68, 68, 0.08)" : "rgba(239, 68, 68, 0.15)",
                  border: isLight ? "1px solid rgba(239, 68, 68, 0.25)" : "1px solid rgba(239, 68, 68, 0.35)",
                  color: isLight ? "#dc2626" : "#f87171",
                  borderRadius: 5,
                  padding: "6px 10px",
                  fontSize: "0.71rem",
                  fontWeight: 600,
                  cursor: !buildingConfig?.targetRow || buildingConfig.targetRow === "custom" ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  opacity: !buildingConfig?.targetRow || buildingConfig.targetRow === "custom" ? 0.5 : 1,
                }}
              >
                <Trash2 size={12} /> Delete Building
              </button>
            </div>
          </div>

          {/* Card 2: Subdivisions (Columns & Rows) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.03)",
              padding: "8px 10px",
              borderRadius: 6,
              border: t.deckBorder,
            }}
          >
            <span style={{ fontSize: "0.66rem", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>
              Plot Subdivisions
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {/* Columns */}
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: "0.64rem", color: t.textSecondary }}>Columns (Length)</span>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <button
                    type="button"
                    disabled={(buildingConfig?.numCols || 10) <= 1}
                    onClick={() => {
                      if (!onUpdateBuildingConfig) return;
                      onUpdateBuildingConfig((prev) => ({
                        ...prev,
                        numCols: Math.max(1, (prev?.numCols || 1) - 1),
                      }));
                    }}
                    title="Reduce column count"
                    aria-label="Reduce column count"
                    style={{
                      width: 24,
                      height: 24,
                      background: (buildingConfig?.numCols || 10) <= 1 ? t.deckBg : t.nudgeBtnBg,
                      border: t.nudgeBtnBorder,
                      color: (buildingConfig?.numCols || 10) <= 1 ? t.textMuted : t.nudgeBtnColor,
                      borderRadius: 4,
                      cursor: (buildingConfig?.numCols || 10) <= 1 ? "not-allowed" : "pointer",
                      fontWeight: 700,
                      opacity: (buildingConfig?.numCols || 10) <= 1 ? 0.45 : 1,
                    }}
                  >
                    -
                  </button>
                  <span
                    style={{
                      flex: 1,
                      textAlign: "center",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      color: isLight ? "#0284c7" : "#38bdf8",
                    }}
                  >
                    {buildingConfig?.numCols || 10}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!onUpdateBuildingConfig) return;
                      onUpdateBuildingConfig((prev) => ({
                        ...prev,
                        numCols: Math.min(50, (prev?.numCols || 1) + 1),
                      }));
                    }}
                    style={{
                      width: 24,
                      height: 24,
                      background: t.nudgeBtnBg,
                      border: t.nudgeBtnBorder,
                      color: t.nudgeBtnColor,
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Rows */}
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: "0.64rem", color: t.textSecondary }}>Rows (Depth)</span>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!onUpdateBuildingConfig) return;
                      onUpdateBuildingConfig((prev) => ({
                        ...prev,
                        numRows: Math.max(1, (prev?.numRows || 1) - 1),
                      }));
                    }}
                    style={{
                      width: 24,
                      height: 24,
                      background: t.nudgeBtnBg,
                      border: t.nudgeBtnBorder,
                      color: t.nudgeBtnColor,
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    -
                  </button>
                  <span
                    style={{
                      flex: 1,
                      textAlign: "center",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      color: isLight ? "#0284c7" : "#38bdf8",
                    }}
                  >
                    {buildingConfig?.numRows || 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!onUpdateBuildingConfig) return;
                      onUpdateBuildingConfig((prev) => ({
                        ...prev,
                        numRows: Math.min(10, (prev?.numRows || 1) + 1),
                      }));
                    }}
                    style={{
                      width: 24,
                      height: 24,
                      background: t.nudgeBtnBg,
                      border: t.nudgeBtnBorder,
                      color: t.nudgeBtnColor,
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Grave Preservation Notice when columns are reduced below occupied slots */}
            {buildingConfig?.numCols < minColsForTargetRow && minColsForTargetRow > 1 && (
              <div
                style={{
                  marginTop: 2,
                  padding: "4px 8px",
                  fontSize: "0.64rem",
                  color: isLight ? "#b45309" : "#fbbf24",
                  background: isLight ? "rgba(245, 158, 11, 0.1)" : "rgba(245, 158, 11, 0.15)",
                  border: isLight ? "1px solid rgba(245, 158, 11, 0.25)" : "1px solid rgba(245, 158, 11, 0.35)",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  lineHeight: 1.3,
                }}
              >
                <AlertCircle size={12} style={{ flexShrink: 0 }} />
                <span>
                  Columns {buildingConfig.numCols + 1}–{minColsForTargetRow} contain registered graves and will safely move to unplaced plots upon saving.
                </span>
              </div>
            )}

            {/* Invert Column Order Toggle */}
            <button
              type="button"
              onClick={() => {
                if (!onUpdateBuildingConfig) return;
                onUpdateBuildingConfig((prev) => ({
                  ...prev,
                  invertCols: !prev?.invertCols,
                }));
              }}
              style={{
                marginTop: 2,
                padding: "4px 8px",
                fontSize: "0.68rem",
                fontWeight: 600,
                background: t.deckBg,
                border: t.deckBorder,
                color: t.textSecondary,
                borderRadius: 4,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <ArrowLeftRight size={11} /> Order Direction:
              </span>
              <strong style={{ color: isLight ? "#0284c7" : "#38bdf8" }}>
                {buildingConfig?.invertCols ? "Right-to-Left (C10 → C01)" : "Left-to-Right (C01 → C10)"}
              </strong>
            </button>
          </div>

          {/* Card 3: Dimensions & Rotation */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.03)",
              padding: "8px 10px",
              borderRadius: 6,
              border: t.deckBorder,
            }}
          >
            <span style={{ fontSize: "0.66rem", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>
              Dimensions & Angle
            </span>

            {/* Length */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span style={{ fontSize: "0.68rem", color: t.textSecondary, minWidth: 60 }}>
                Length: <strong style={{ color: isLight ? "#059669" : "#34d399" }}>{(buildingConfig?.lengthMeters ?? DEFAULT_BUILDING_LENGTH_M).toFixed(1)}m</strong>
              </span>
              <input
                type="range"
                aria-label="Building length in meters"
                min="4"
                max="80"
                step="0.5"
                value={buildingConfig?.lengthMeters ?? DEFAULT_BUILDING_LENGTH_M}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (onUpdateBuildingConfig) {
                    onUpdateBuildingConfig((prev) => ({ ...prev, lengthMeters: val }));
                  }
                }}
                style={{ flex: 1, accentColor: "#10b981", height: 4 }}
              />
              <div style={{ display: "flex", gap: 2 }}>
                <button
                  type="button"
                  onClick={() => onUpdateBuildingConfig && onUpdateBuildingConfig((prev) => ({ ...prev, lengthMeters: Math.max(4, Number(((prev?.lengthMeters ?? DEFAULT_BUILDING_LENGTH_M) - 0.5).toFixed(1))) }))}
                  style={{ width: 22, height: 22, background: t.nudgeBtnBg, border: t.nudgeBtnBorder, color: t.nudgeBtnColor, borderRadius: 3, cursor: "pointer", fontSize: "0.68rem", fontWeight: 700 }}
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateBuildingConfig && onUpdateBuildingConfig((prev) => ({ ...prev, lengthMeters: Math.min(80, Number(((prev?.lengthMeters ?? DEFAULT_BUILDING_LENGTH_M) + 0.5).toFixed(1))) }))}
                  style={{ width: 22, height: 22, background: t.nudgeBtnBg, border: t.nudgeBtnBorder, color: t.nudgeBtnColor, borderRadius: 3, cursor: "pointer", fontSize: "0.68rem", fontWeight: 700 }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Width */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span style={{ fontSize: "0.68rem", color: t.textSecondary, minWidth: 60 }}>
                Width: <strong style={{ color: isLight ? "#7c3aed" : "#c084fc" }}>{(buildingConfig?.widthMeters ?? DEFAULT_BUILDING_WIDTH_M).toFixed(1)}m</strong>
              </span>
              <input
                type="range"
                aria-label="Building width in meters"
                min="1"
                max="20"
                step="0.2"
                value={buildingConfig?.widthMeters ?? DEFAULT_BUILDING_WIDTH_M}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (onUpdateBuildingConfig) {
                    onUpdateBuildingConfig((prev) => ({ ...prev, widthMeters: val }));
                  }
                }}
                style={{ flex: 1, accentColor: "#a855f7", height: 4 }}
              />
              <div style={{ display: "flex", gap: 2 }}>
                <button
                  type="button"
                  onClick={() => onUpdateBuildingConfig && onUpdateBuildingConfig((prev) => ({ ...prev, widthMeters: Math.max(1, Number(((prev?.widthMeters ?? DEFAULT_BUILDING_WIDTH_M) - 0.2).toFixed(1))) }))}
                  style={{ width: 22, height: 22, background: t.nudgeBtnBg, border: t.nudgeBtnBorder, color: t.nudgeBtnColor, borderRadius: 3, cursor: "pointer", fontSize: "0.68rem", fontWeight: 700 }}
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateBuildingConfig && onUpdateBuildingConfig((prev) => ({ ...prev, widthMeters: Math.min(20, Number(((prev?.widthMeters ?? DEFAULT_BUILDING_WIDTH_M) + 0.2).toFixed(1))) }))}
                  style={{ width: 22, height: 22, background: t.nudgeBtnBg, border: t.nudgeBtnBorder, color: t.nudgeBtnColor, borderRadius: 3, cursor: "pointer", fontSize: "0.68rem", fontWeight: 700 }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Angle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span style={{ fontSize: "0.68rem", color: t.textSecondary, minWidth: 60 }}>
                Angle: <strong style={{ color: isLight ? "#d97706" : "#fbbf24" }}>{(buildingConfig?.angleDeg ?? DEFAULT_GRID_ANGLE_DEG).toFixed(1)}°</strong>
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                {[-5, -0.5, 0.5, 5].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => {
                      if (!onUpdateBuildingConfig) return;
                      onUpdateBuildingConfig((prev) => {
                        let a = (prev?.angleDeg ?? DEFAULT_GRID_ANGLE_DEG) + delta;
                        if (a < 0) a += 360;
                        if (a >= 360) a -= 360;
                        return { ...prev, angleDeg: Number(a.toFixed(1)) };
                      });
                    }}
                    style={{
                      padding: "2px 5px",
                      fontSize: "0.66rem",
                      fontWeight: 600,
                      background: t.nudgeBtnBg,
                      border: t.nudgeBtnBorder,
                      color: t.nudgeBtnColor,
                      borderRadius: 3,
                      cursor: "pointer",
                    }}
                  >
                    {delta > 0 ? `+${delta}°` : `${delta}°`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Card 4: Nudge Position & Step Size */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.03)",
              padding: "8px 10px",
              borderRadius: 6,
              border: t.deckBorder,
            }}
          >
            {/* Step size */}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: "0.62rem", color: t.textMuted, textTransform: "uppercase", fontWeight: 700 }}>
                Step Size
              </span>
              <div style={{ display: "flex", gap: 2 }}>
                {[0.1, 0.5, 2.0].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStepSize(s)}
                    style={{
                      padding: "3px 6px",
                      fontSize: "0.68rem",
                      fontWeight: 600,
                      borderRadius: 3,
                      border: stepSize === s ? t.stepActiveBorder : t.stepInactiveBorder,
                      background: stepSize === s ? t.stepActiveBg : t.stepInactiveBg,
                      color: stepSize === s ? t.stepActiveColor : t.stepInactiveColor,
                      cursor: "pointer",
                    }}
                  >
                    {s}m
                  </button>
                ))}
              </div>
            </div>

            {/* D-Pad */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 26px)", gap: 2, alignItems: "center" }}>
              <div />
              <button
                type="button"
                onClick={() => handleNudgeBuilding("up")}
                title="Nudge North"
                aria-label="Nudge North"
                style={{ ...nudgeBtnStyle, width: 26, height: 24 }}
              >
                <ChevronUp size={14} />
              </button>
              <div />
              <button
                type="button"
                onClick={() => handleNudgeBuilding("left")}
                title="Nudge West"
                aria-label="Nudge West"
                style={{ ...nudgeBtnStyle, width: 26, height: 24 }}
              >
                <ChevronLeft size={14} />
              </button>
              <div style={{ width: 26, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Compass size={12} style={{ color: isLight ? "#0284c7" : "#38bdf8", opacity: 0.7 }} />
              </div>
              <button
                type="button"
                onClick={() => handleNudgeBuilding("right")}
                title="Nudge East"
                aria-label="Nudge East"
                style={{ ...nudgeBtnStyle, width: 26, height: 24 }}
              >
                <ChevronRight size={14} />
              </button>
              <div />
              <button
                type="button"
                onClick={() => handleNudgeBuilding("down")}
                title="Nudge South"
                aria-label="Nudge South"
                style={{ ...nudgeBtnStyle, width: 26, height: 24 }}
              >
                <ChevronDown size={14} />
              </button>
              <div />
            </div>
          </div>

          {/* Card 5: Apply & Save Action Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" }}>
            <button
              type="button"
              onClick={handleApplyBuildingPlots}
              disabled={saving}
              style={{
                width: "100%",
                padding: "8px 14px",
                background: saving ? "#047857" : "#059669",
                color: "#ffffff",
                border: "1px solid #047857",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 700,
                cursor: saving ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                boxShadow: "0 2px 6px rgba(5, 150, 105, 0.35)",
              }}
            >
              <Check size={14} strokeWidth={2.5} />
              <span>{saving ? "Saving Coordinates..." : "Apply & Save to Database"}</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmDeleteRow(buildingConfig?.targetRow || null)}
              disabled={saving || !buildingConfig?.targetRow || buildingConfig.targetRow === "custom"}
              title="Delete this entire building row from the map and database"
              style={{
                width: "100%",
                padding: "6px 10px",
                background: "transparent",
                color: isLight ? "#dc2626" : "#f87171",
                border: isLight ? "1px dashed rgba(239, 68, 68, 0.35)" : "1px dashed rgba(239, 68, 68, 0.45)",
                borderRadius: 6,
                fontSize: "0.72rem",
                fontWeight: 600,
                cursor: !buildingConfig?.targetRow || buildingConfig.targetRow === "custom" ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                opacity: !buildingConfig?.targetRow || buildingConfig.targetRow === "custom" ? 0.5 : 1,
              }}
            >
              <Trash2 size={12} />
              <span>Delete Entire {buildingConfig?.targetRow ? buildingLabel(buildingConfig.targetRow) : "Building"}</span>
            </button>

            <div style={{ display: "flex", gap: 6 }}>
              {modifiedCount > 0 ? (
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  style={{
                    flex: 1,
                    padding: "7px 12px",
                    background: "#2563eb",
                    color: "#ffffff",
                    border: "1px solid #1d4ed8",
                    borderRadius: 6,
                    fontSize: "0.76rem",
                    fontWeight: 700,
                    cursor: saving ? "default" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                  }}
                >
                  <Save size={13} />
                  <span>{saving ? "Saving..." : `Save (${modifiedCount})`}</span>
                </button>
              ) : null}

              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: modifiedCount > 0 ? 1 : undefined,
                  width: modifiedCount > 0 ? undefined : "100%",
                  padding: "7px 12px",
                  background: t.doneBtnBg,
                  color: t.doneBtnColor,
                  border: t.doneBtnBorder,
                  borderRadius: 6,
                  fontSize: "0.76rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alignment Guide (Formal Collapsible Accordion) */}
      {showHelp && (
        <div
          style={{
            fontSize: "0.72rem",
            color: t.guideText,
            background: t.guideBg,
            padding: "10px 12px",
            borderRadius: 6,
            lineHeight: 1.45,
            border: t.guideBorder,
            borderLeft: t.guideBorderLeft,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: t.guideTitle, marginBottom: 4 }}>
            <Info size={13} style={{ color: isLight ? "#0284c7" : "#38bdf8" }} />
            <span>GIS Alignment Procedure:</span>
          </div>
          <ol style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
            <li>
              <strong>Target Scope:</strong> Select <em>Entire Cemetery Grid</em> or isolate an individual row.
            </li>
            <li>
              <strong>Coarse Positioning:</strong> Click and drag the central cyan <strong>✥ Anchor</strong> on the map.
            </li>
            <li>
              <strong>Precision Nudging:</strong> Use the compass directional pad to align with concrete roof slabs.
            </li>
            <li>
              <strong>Orientation:</strong> Incrementally adjust rotation angle by ±0.5°.
            </li>
            <li>
              <strong>Commit Coordinates:</strong> Click <strong>Save Changes</strong> to write to database.
            </li>
          </ol>
        </div>
      )}

      {/* ─── Layout Preset Confirmation Modal ─── */}
      {showPresetModal && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0, 0, 0, 0.72)",
            backdropFilter: "blur(4px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            borderRadius: 12,
          }}
        >
          <div
            style={{
              background: t.panelBg,
              border: "1px solid rgba(16, 185, 129, 0.4)",
              borderRadius: 10,
              padding: 16,
              maxWidth: 390,
              width: "100%",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div
                style={{
                  width: "auto",
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "#10b981",
                }}
              >
                <BookmarkCheck size={18} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <h4 style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700, color: t.textPrimary }}>
                  Apply the “{LAYOUT_PRESET_SUMMARY.name}” preset?
                </h4>
                <p style={{ margin: 0, fontSize: "0.72rem", color: t.textSecondary, lineHeight: 1.4 }}>
                  {LAYOUT_PRESET?.description || `Load and calibrate all ${LAYOUT_PRESET_SUMMARY.rowCount} building rows from the layout preset.`}
                </p>
              </div>
            </div>

            <div
              style={{
                background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.04)",
                border: t.deckBorder,
                borderRadius: 6,
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: "0.7rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", color: t.textSecondary }}>
                <span>Active Apartment Buildings:</span>
                <strong style={{ color: t.textPrimary }}>{LAYOUT_PRESET_SUMMARY.rowCount} Rows</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: t.textSecondary }}>
                <span>Total Pinned Plots:</span>
                <strong style={{ color: "#10b981" }}>{LAYOUT_PRESET_SUMMARY.totalPlots} Plots</strong>
              </div>
              {LAYOUT_DELETED_ROWS.length > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: t.textSecondary }}>
                  <span>Retired rows ({LAYOUT_DELETED_ROWS.map(buildingLabel).join(", ")}):</span>
                  <span style={{ color: t.textMuted }}>Graves preserved in Unplaced</span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setShowPresetModal(false)}
                disabled={saving || applyingPreset}
                style={{
                  flex: 1,
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: t.deckBorder,
                  background: t.nudgeBtnBg,
                  color: t.textPrimary,
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: saving || applyingPreset ? "default" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyPreset}
                disabled={saving || applyingPreset}
                style={{
                  flex: 1.3,
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: "1px solid #059669",
                  background: "#10b981",
                  color: "#ffffff",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: saving || applyingPreset ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  boxShadow: "0 2px 6px rgba(16, 185, 129, 0.4)",
                  opacity: applyingPreset ? 0.7 : 1,
                }}
              >
                <BookmarkCheck size={14} />
                <span>{applyingPreset ? "Saving Preset..." : saving ? "Saving..." : "Apply & Save Preset"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Building Confirmation Modal ─── */}
      {confirmDeleteRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="adjuster-delete-title"
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0, 0, 0, 0.72)",
            backdropFilter: "blur(4px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            borderRadius: 12,
          }}
        >
          <div
            style={{
              background: t.panelBg,
              border: "1px solid rgba(239, 68, 68, 0.4)",
              borderRadius: 10,
              padding: 16,
              maxWidth: 380,
              width: "100%",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div
                style={{
                  width: "auto",
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "#ef4444",
                }}
              >
                <Trash2 size={18} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <h4 id="adjuster-delete-title" style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700, color: t.textPrimary }}>
                  Delete {buildingLabel(confirmDeleteRow)}?
                </h4>
                <p style={{ margin: 0, fontSize: "0.72rem", color: t.textSecondary, lineHeight: 1.4 }}>
                  Are you sure you want to completely remove this building structure from the map?
                </p>
              </div>
            </div>

            <div
              style={{
                background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.04)",
                border: t.deckBorder,
                borderRadius: 6,
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: "0.7rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", color: t.textSecondary }}>
                <span>Total plots in building:</span>
                <strong style={{ color: t.textPrimary }}>{deleteRowPlots.length}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: t.textSecondary }}>
                <span>Empty plots to permanently delete:</span>
                <strong style={{ color: "#ef4444" }}>{deleteEmptyCount}</strong>
              </div>

              {deleteOccupiedPlots.length > 0 && (
                <div
                  style={{
                    marginTop: 4,
                    padding: "6px 8px",
                    borderRadius: 5,
                    background: "rgba(245, 158, 11, 0.12)",
                    border: "1px solid rgba(245, 158, 11, 0.25)",
                    color: isLight ? "#b45309" : "#fbbf24",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 700 }}>
                    <AlertTriangle size={12} />
                    <span>{deleteOccupiedPlots.length} Occupied Plot(s) Protected</span>
                  </div>
                  <span style={{ fontSize: "0.64rem", lineHeight: 1.35, color: isLight ? "#92400e" : "#fde68a" }}>
                    Plots with graves ({deleteOccupiedPlots.map((p) => p.plotNumber).join(", ")}) will NOT be deleted. They will be unpinned and safely moved to the Unplaced list to preserve all burial records.
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setConfirmDeleteRow(null)}
                disabled={saving}
                autoFocus
                style={{
                  flex: 1,
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: t.deckBorder,
                  background: t.nudgeBtnBg,
                  color: t.textPrimary,
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteBuilding(confirmDeleteRow)}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: "1px solid #dc2626",
                  background: "#dc2626",
                  color: "#ffffff",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: saving ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  boxShadow: "0 2px 6px rgba(220, 38, 38, 0.4)",
                }}
              >
                <Trash2 size={13} />
                <span>{saving ? "Deleting..." : "Confirm & Delete"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
