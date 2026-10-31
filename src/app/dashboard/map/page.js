"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Plus, Pencil, Check, MapPinOff, AlertTriangle, X, Crosshair, Compass, MapPin, Move, Maximize2, Minimize2 } from "lucide-react";
import NavigationOverlay from "../../../components/NavigationOverlay";
import PlotDetailsDrawer from "../../../components/PlotDetailsDrawer";
import PlotPositionAdjuster from "../../../components/PlotPositionAdjuster";
import { getSubdividedBuildingCells, applyBuildingCellsToPlots } from "../../../lib/building-grid";
import { useBodyScrollLock } from "../../../lib/use-body-scroll-lock";
import {
  DEFAULT_BUILDING_LENGTH_M,
  DEFAULT_BUILDING_WIDTH_M,
  DEFAULT_GRID_ANGLE_DEG,
  SITE_NAME,
  getClientMapCenter,
} from "../../../lib/config";
import { plotsOfBuilding, blockFullLabel } from "@/lib/cemetery-layout";
import { deriveBoundaryOffsets } from "@/lib/map-geometry";
import { siteBoundaryOffsets, siteOverlay } from "@/lib/site-overlay";
import { useHistoryStack } from "@/lib/use-history-stack";
import { useBoundarySettings } from "@/lib/use-boundary-settings";

// 2D satellite or 3D map, as the viewer chooses; the Admin's layout tools
// (adjust, edit positions, place a new plot) always use the 2D map.
const CemeteryMapView = dynamic(() => import("../../../components/CemeteryMapView"), {
  ssr: false,
  loading: () => (
    <div className="card" style={{ height: "100%", minHeight: 500, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="spinner spinner-lg"></div>
    </div>
  ),
});

function hasGps(p) {
  return p && p.gpsLat != null && p.gpsLng != null;
}

// Simple centered modal wrapper.
function Modal({ title, onClose, children, footer, maxWidth = 480 }) {
  useBodyScrollLock(true);
  return (
    <div
      className="modal-overlay"
      onClick={onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth, width: "100%" }}>
        <div className="flex justify-between items-center" style={{ marginBottom: "0.85rem" }}>
          {typeof title === "string" ? <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>{title}</h3> : title}
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {children}
        {footer && <div className="flex gap-sm w-full" style={{ marginTop: "0.75rem" }}>{footer}</div>}
      </div>
    </div>
  );
}

function MapPageInner() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "Admin";
  const searchParams = useSearchParams();

  const [plots, setPlots] = useState([]);
  const [locations, setLocations] = useState([]);
  const [routeCoords, setRouteCoords] = useState(null);

  // View: plot shown in the side details drawer.
  const [detailsPlot, setDetailsPlot] = useState(null);
  const [drawerCollapsed, setDrawerCollapsed] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  // Edit-locations mode (drag & drop existing markers).
  const [editing, setEditing] = useState(false);

  // Adjust / Crop transform mode (custom positioning)
  const [adjustMode, setAdjustMode] = useState(false);
  const [selectedScope, setSelectedScope] = useState("all");
  // Which adjuster tab is open; the building generator is only live on "building".
  const [adjusterTab, setAdjusterTab] = useState("plots");
  const [gridAngle, setGridAngle] = useState(DEFAULT_GRID_ANGLE_DEG);
  const [savingBatch, setSavingBatch] = useState(false);
  const originalPlotsRef = useRef([]);
  const {
    canUndo,
    canRedo,
    push: pushHistorySnapshot,
    reset: resetHistory,
    clear: clearHistory,
    undo: undoHistory,
    redo: redoHistory,
  } = useHistoryStack();
  const [toast, setToast] = useState("");

  // Blue boundary area customization (shared, server-persisted polygon)
  const {
    boundaryOffsets,
    updateBoundaryOffsets: handleUpdateBoundaryOffsets,
    resetBoundary: handleResetBoundary,
  } = useBoundarySettings({ notify: setToast });

  // Saved boundary, else a padded rectangle derived from the building plots.
  const effectiveBoundaryOffsets = useMemo(
    // A saved boundary wins; else the cemetery's own outline (the paved yard),
    // else a rectangle round the rows and the blocks not mapped yet.
    () =>
      boundaryOffsets ??
      siteBoundaryOffsets(plots, gridAngle) ??
      deriveBoundaryOffsets(plots, gridAngle, 8, siteOverlay({ plots, gridAngle }).blocks.flatMap((b) => b.path)),
    [boundaryOffsets, plots, gridAngle]
  );
  const [editBoundaryLines, setEditBoundaryLines] = useState(false);

  // Building Block / Row Generator Configuration
  // Starts at the configured map centre; the adjuster picks the target row
  // from the buildings that actually exist (or "custom" for a new one).
  const [buildingConfig, setBuildingConfig] = useState(() => {
    const c = getClientMapCenter();
    return {
      active: false,
      targetRow: null,
      numCols: 10,
      numRows: 1,
      lengthMeters: DEFAULT_BUILDING_LENGTH_M,
      widthMeters: DEFAULT_BUILDING_WIDTH_M,
      angleDeg: DEFAULT_GRID_ANGLE_DEG,
      centerLat: c.lat,
      centerLng: c.lng,
      invertCols: false,
    };
  });
  const [confirmDeleteRow, setConfirmDeleteRow] = useState(null);

  // In-page fullscreen mode (hides sidebar & dashboard header)
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    if (isFullScreen) {
      document.body.classList.add("map-fullscreen-active");
    } else {
      document.body.classList.remove("map-fullscreen-active");
    }

    const t1 = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 60);
    const t2 = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      document.body.classList.remove("map-fullscreen-active");
    };
  }, [isFullScreen]);

  // Press Escape to exit fullscreen mode
  useEffect(() => {
    if (!isFullScreen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsFullScreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullScreen]);

  // Placement: setting one plot's location. `pending` is either an existing
  // plot object, or { isNew: true, plotNumber, locationDetailId } for a new one.
  const [pending, setPending] = useState(null);
  const [draftCoords, setDraftCoords] = useState(null);

  // Add-plot metadata modal.
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ locationDetailId: "", plotNumber: "" });

  const [unplacedOpen, setUnplacedOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchPlots = useCallback(async () => {
    try {
      const res = await fetch("/api/plots?limit=1000", { cache: "no-store" });
      const data = await res.json();
      setPlots(data.plots || []);
      return data.plots || [];
    } catch (err) {
      console.error(err);
      return [];
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(fetchPlots);
    (async () => {
      try {
        const res = await fetch("/api/locations");
        setLocations((await res.json()) || []);
      } catch (err) {
        console.error(err);
      }
    })();
  }, [fetchPlots]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Derive the fresh plot data for the open side-panel plot whenever plots array
  // is refreshed, so edits made on other pages are reflected immediately without
  // cascading re-render effects.
  const activeDetailsPlot = useMemo(() => {
    if (!detailsPlot) return null;
    return plots.find((p) => p.id === detailsPlot.id) || detailsPlot;
  }, [plots, detailsPlot]);

  // Re-fetch plots whenever the user returns to this browser tab so changes
  // made on other dashboard pages (e.g. updating DOB/DOD in Grave Records)
  // are visible without a manual page refresh.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") fetchPlots();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchPlots]);

  const unpinned = plots.filter((p) => !hasGps(p));

  // Resolve a section's subsection label (e.g. "A1") from its detail id.
  const subsectionOf = useCallback((locationDetailId) => {
    for (const loc of locations) {
      for (const det of loc.details || []) {
        if (String(det.id) === String(locationDetailId)) return det.subsection || "P";
      }
    }
    return "P";
  }, [locations]);

  // Suggest the next plot number for a section: "<subsection>-<NNN>" using the
  // highest existing trailing number in that section + 1.
  const nextPlotNumber = useCallback((locationDetailId) => {
    if (!locationDetailId) return "";
    const subsection = subsectionOf(locationDetailId);
    let max = 0;
    for (const p of plots) {
      const ld = p.locationDetailId ?? p.locationDetail?.id;
      if (String(ld) !== String(locationDetailId)) continue;
      const m = /(\d+)\s*$/.exec(p.plotNumber || "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${subsection}-${String(max + 1).padStart(3, "0")}`;
  }, [plots, subsectionOf]);

  const sectionPoint = useCallback((locationDetailId) => {
    if (!locationDetailId) return null;
    for (const loc of locations) {
      for (const det of loc.details || []) {
        if (String(det.id) === String(locationDetailId)) {
          if (loc.gpsLat != null && loc.gpsLng != null) return { lat: Number(loc.gpsLat), lng: Number(loc.gpsLng) };
          return null;
        }
      }
    }
    return null;
  }, [locations]);

  const scrollToMap = useCallback(() => {
    setTimeout(() => {
      document.getElementById("cemetery-map-container")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, []);

  const startPlacing = useCallback((plot) => {
    setDetailsPlot(null);
    setRouteCoords(null);
    setEditing(false);
    setAdjustMode(false);
    setError("");
    setPending(plot);
    setDraftCoords(hasGps(plot) ? { lat: Number(plot.gpsLat), lng: Number(plot.gpsLng) } : null);
    scrollToMap();
  }, [scrollToMap]);

  const lastHandledTargetRef = useRef("");

  // Deep-link: /dashboard/map?plot=<id|plotNumber> or ?q=<term>
  useEffect(() => {
    const target = searchParams.get("plot");
    const q = searchParams.get("q");
    if ((!target && !q) || !plots.length) return;

    const key = `${target || ""}:${q || ""}`;
    if (lastHandledTargetRef.current === key) return;

    let plot = null;
    if (target) {
      plot = plots.find(
        (item) => String(item.id) === String(target) || item.plotNumber?.toLowerCase() === target.toLowerCase()
      );
    } else if (q) {
      const qLower = q.toLowerCase();
      plot = plots.find(
        (item) =>
          item.plotNumber?.toLowerCase().includes(qLower) ||
          item.graves?.some((g) => g.deceasedName?.toLowerCase().includes(qLower))
      );
    }
    if (!plot) return;

    lastHandledTargetRef.current = key;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (hasGps(plot)) {
        setDetailsPlot((prev) => (prev?.id === plot.id ? prev : plot));
        setDrawerCollapsed(false);
      } else if (isAdmin) {
        startPlacing(plot);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [searchParams, plots, isAdmin, startPlacing]);

  const [cemeteryFocus, setCemeteryFocus] = useState(null);

  const handleLocateCemetery = useCallback(() => {
    const c = getClientMapCenter();
    setCemeteryFocus({ lat: c.lat, lng: c.lng, key: Date.now() });
    setToast(`Centered on ${SITE_NAME}`);
    setTimeout(() => {
      document.getElementById("cemetery-map-container")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, [setToast]);

  const lastHandledLocateRef = useRef(false);

  // Deep-link: /dashboard/map?locate=cemetery ("bolonsiri" kept for old links)
  useEffect(() => {
    const locate = searchParams.get("locate");
    if (locate !== "cemetery" && locate !== "bolonsiri") {
      lastHandledLocateRef.current = false;
      return undefined;
    }
    if (lastHandledLocateRef.current) return undefined;
    lastHandledLocateRef.current = true;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      handleLocateCemetery();
    });
    return () => {
      cancelled = true;
    };
  }, [searchParams, handleLocateCemetery]);

  function resetModes() {
    setPending(null);
    setDraftCoords(null);
    setEditing(false);
    setAdjustMode(false);
    setAddOpen(false);
    setUnplacedOpen(false);
    setError("");
  }

  function openAdd() {
    resetModes();
    setAddForm({ locationDetailId: "", plotNumber: "" });
    setAddOpen(true);
  }

  function proceedAddToMap(e) {
    e.preventDefault();
    if (!addForm.locationDetailId) return;
    // plotNumber here is only a preview; the server assigns the authoritative,
    // incremented number on create.
    setPending({ isNew: true, locationDetailId: addForm.locationDetailId, plotNumber: addForm.plotNumber || nextPlotNumber(addForm.locationDetailId) });
    setDraftCoords(null);
    setAddOpen(false);
    scrollToMap();
  }

  function toggleEditing() {
    if (editing) {
      setEditing(false);
    } else {
      resetModes();
      setDetailsPlot(null);
      setRouteCoords(null);
      setEditing(true);
      scrollToMap();
    }
  }

  const pushHistory = useCallback(
    (newPlots, newAngle) => {
      pushHistorySnapshot({
        plots: JSON.parse(JSON.stringify(newPlots)),
        gridAngle: newAngle ?? gridAngle,
      });
    },
    [pushHistorySnapshot, gridAngle]
  );

  const handleUpdatePlotsWithHistory = useCallback(
    (updatedPlots) => {
      setPlots(updatedPlots);
      pushHistory(updatedPlots, gridAngle);
    },
    [gridAngle, pushHistory]
  );

  const restoreSnapshot = useCallback((target) => {
    if (!target) return;
    setPlots(JSON.parse(JSON.stringify(target.plots)));
    if (target.gridAngle != null) setGridAngle(target.gridAngle);
  }, []);

  const handleUndo = useCallback(() => {
    const target = undoHistory();
    if (!target) return;
    restoreSnapshot(target);
    setToast("Undo (Ctrl+Z)");
  }, [undoHistory, restoreSnapshot]);

  const handleRedo = useCallback(() => {
    const target = redoHistory();
    if (!target) return;
    restoreSnapshot(target);
    setToast("Restore / Redo (Ctrl+Y)");
  }, [redoHistory, restoreSnapshot]);

  const handleCancelAdjust = useCallback(() => {
    if (originalPlotsRef.current && originalPlotsRef.current.length > 0) {
      setPlots(JSON.parse(JSON.stringify(originalPlotsRef.current)));
    } else {
      setPlots((prev) => prev.map((p) => (p._modified ? { ...p, _modified: false } : p)));
    }
    clearHistory();
    setAdjustMode(false);
    setEditBoundaryLines(false);
    setBuildingConfig((prev) => ({ ...prev, active: false }));
    setToast("Editing cancelled. All changes discarded.");
  }, [setToast, clearHistory]);

  function toggleAdjustMode() {
    if (adjustMode) {
      if (plots.some((p) => p._modified)) {
        handleCancelAdjust();
      } else {
        setAdjustMode(false);
        setEditBoundaryLines(false);
        setBuildingConfig((prev) => ({ ...prev, active: false }));
      }
    } else {
      resetModes();
      setDetailsPlot(null);
      setRouteCoords(null);
      const snapshot = JSON.parse(JSON.stringify(plots));
      originalPlotsRef.current = snapshot;
      resetHistory({ plots: snapshot, gridAngle: gridAngle ?? DEFAULT_GRID_ANGLE_DEG });
      setAdjustMode(true);
      scrollToMap();
      setToast("Adjust mode: drag central anchor or use buttons to align grid");
    }
  }

  // Keyboard shortcut listener for Ctrl+Z (Undo) and Ctrl+Y (Restore/Redo)
  useEffect(() => {
    if (!adjustMode) return;

    const handleKeyDown = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta) return;

      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [adjustMode, handleUndo, handleRedo]);

  const handleSaveBatchPlots = useCallback(
    async (overridePlots = null) => {
      const list = Array.isArray(overridePlots) ? overridePlots : plots;
      const modified = list.filter((p) => p._modified && !p._deleted);
      const deletePlotIds = list
        .filter((p) => p._deleted && p.id && Number.isInteger(Number(p.id)) && Number(p.id) > 0)
        .map((p) => Number(p.id));

      if (modified.length === 0 && deletePlotIds.length === 0) {
        setToast("No plots were modified");
        return false;
      }
      setSavingBatch(true);
      try {
        const res = await fetch("/api/plots/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plots: modified.map((p) => ({
              id: p.id || null,
              plotNumber: p.plotNumber,
              locationDetailId: p.locationDetailId || p.locationDetail?.id || null,
              totalTiers: p.totalTiers ?? null,
              buildingKey: p._buildingKey || p.locationDetail?.subsection || null,
              status: p.status || "available",
              gpsLat: p.gpsLat != null ? Number(p.gpsLat) : null,
              gpsLng: p.gpsLng != null ? Number(p.gpsLng) : null,
            })),
            deletePlotIds,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const returnedPlotsMap = new Map();
          for (const ret of data.plots || []) {
            if (ret.plotNumber) returnedPlotsMap.set(ret.plotNumber, ret);
            if (ret.id) returnedPlotsMap.set(`id-${ret.id}`, ret);
          }

          const deletedSet = new Set(data.deletedIds || deletePlotIds);

          const savedPlots = list
            .filter((p) => !deletedSet.has(Number(p.id)) && !p._deleted)
            .map((p) => {
              const ret =
                (p.plotNumber && returnedPlotsMap.get(p.plotNumber)) ||
                (p.id && returnedPlotsMap.get(`id-${p.id}`));
              if (ret) {
                return {
                  ...p,
                  ...ret,
                  _modified: false,
                  _isNew: false,
                  _deleted: false,
                };
              }
              return p._modified ? { ...p, _modified: false } : p;
            });

          setPlots(savedPlots);
          originalPlotsRef.current = JSON.parse(JSON.stringify(savedPlots));
          resetHistory({ plots: savedPlots, gridAngle });

          let toastMsg = `Successfully saved ${data.updatedCount || modified.length} plot positions!`;
          if (data.deletedCount > 0) {
            toastMsg = `Successfully saved: updated ${data.updatedCount || 0} plots, removed ${data.deletedCount} columns!`;
          }
          setToast(toastMsg);
          if (data.skippedCount > 0) {
            setError(
              `${data.skippedCount} plot(s) could not be saved because they are not in a section. Assign them to a section and try again.`
            );
          }
          return true;
        } else {
          const err = await res.json().catch(() => ({}));
          setError(err.error || "Failed to save plot positions");
          setToast("Failed to save changes");
          return false;
        }
      } catch (err) {
        console.error("Batch save error:", err);
        setError("Failed to save plot positions");
        setToast("Error saving changes");
        return false;
      } finally {
        setSavingBatch(false);
      }
    },
    [plots, gridAngle, setToast, setError, resetHistory]
  );

  const handlePresetSuccess = useCallback(
    async (freshPlots) => {
      if (Array.isArray(freshPlots) && freshPlots.length > 0) {
        setPlots(freshPlots);
        originalPlotsRef.current = JSON.parse(JSON.stringify(freshPlots));
        resetHistory({ plots: freshPlots, gridAngle });
      }
      setToast(`Layout preset saved to database! ${Array.isArray(freshPlots) ? freshPlots.length : 0} plots loaded.`);
      try {
        const res = await fetch("/api/locations");
        if (res.ok) {
          setLocations((await res.json()) || []);
        }
      } catch (e) {
        console.error(e);
      }
    },
    [gridAngle, setToast, resetHistory]
  );

  const handleApplyAndSaveBuildingConfig = useCallback(
    async (cfg = buildingConfig) => {
      if (!cfg) return;
      const targetPlots = plotsOfBuilding(plots, cfg.targetRow);

      if (targetPlots.length === 0) {
        setToast(`No plots found for row ${cfg.targetRow}`);
        return;
      }

      const cells = getSubdividedBuildingCells({
        centerLat: cfg.centerLat,
        centerLng: cfg.centerLng,
        lengthMeters: cfg.lengthMeters,
        widthMeters: cfg.widthMeters,
        angleDeg: cfg.angleDeg,
        numCols: cfg.numCols || targetPlots.length,
        numRows: cfg.numRows || 1,
        invertCols: cfg.invertCols || false,
        targetPlots,
        targetRow: cfg.targetRow,
      });

      const updated = applyBuildingCellsToPlots(cells, plots, cfg.targetRow);
      setPlots(updated);
      pushHistory(updated, gridAngle);
      await handleSaveBatchPlots(updated);
    },
    [buildingConfig, plots, gridAngle, pushHistory, handleSaveBatchPlots, setToast]
  );

  function handleSinglePlotDrag(plot, lat, lng) {
    const updated = plots.map((p) =>
      p.id === plot.id
        ? {
            ...p,
            gpsLat: Number(lat.toFixed(8)),
            gpsLng: Number(lng.toFixed(8)),
            _modified: true,
          }
        : p
    );
    setPlots(updated);
    pushHistory(updated, gridAngle);
    setToast(`Relocated ${plot.plotNumber} (Click Save when done)`);
  }

  const draftMarker = pending && draftCoords ? draftCoords : null;

  const focusPoint = useMemo(() => {
    if (pending) {
      if (!pending.isNew && hasGps(pending)) return { lat: Number(pending.gpsLat), lng: Number(pending.gpsLng) };
      const ldId = pending.isNew ? pending.locationDetailId : (pending.locationDetailId ?? pending.locationDetail?.id);
      return sectionPoint(ldId);
    }
    if (activeDetailsPlot && hasGps(activeDetailsPlot)) return { lat: Number(activeDetailsPlot.gpsLat), lng: Number(activeDetailsPlot.gpsLng) };
    if (cemeteryFocus) return { lat: cemeteryFocus.lat, lng: cemeteryFocus.lng };
    return null;
  }, [pending, activeDetailsPlot, cemeteryFocus, sectionPoint]);

  function handleMapClick(lat, lng) {
    if (!pending) return;
    setDraftCoords({ lat, lng });
  }

  async function savePlacement() {
    if (!pending || !draftCoords) {
      setError("Click on the map to place the marker first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const isNew = !!pending.isNew;
      const url = isNew ? "/api/plots" : `/api/plots/${pending.id}`;
      const method = isNew ? "POST" : "PUT";
      // For new plots, omit plotNumber so the server assigns the next
      // incremented number for the section (race-safe).
      const payload = isNew
        ? { locationDetailId: parseInt(pending.locationDetailId, 10), gpsLat: Number(draftCoords.lat), gpsLng: Number(draftCoords.lng) }
        : { gpsLat: Number(draftCoords.lat), gpsLng: Number(draftCoords.lng) };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const saved = await res.json().catch(() => null);
        const refreshed = await fetchPlots();
        setPending(null);
        setDraftCoords(null);
        setToast(isNew ? `Plot ${saved?.plotNumber ?? ""} added` : "Location updated");
        const savedId = saved?.id ?? (!isNew ? pending.id : null);
        const found = refreshed.find((p) => p.id === savedId);
        if (found) setDetailsPlot(found);
      } else if (res.status === 401 || res.status === 403) {
        setError("You don't have permission to manage plots.");
      } else if (res.status === 409) {
        setError("A plot with this number already exists in this section.");
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message || body?.error || "Failed to save.");
      }
    } catch (err) {
      console.error(err);
      setError("An unexpected error occurred while saving.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePlotDragEnd(plot, lat, lng) {
    try {
      const res = await fetch(`/api/plots/${plot.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpsLat: Number(lat), gpsLng: Number(lng) }),
      });
      if (res.ok) {
        // Update local coordinates without a full refetch to keep the marker put.
        setPlots((prev) => prev.map((p) => (p.id === plot.id ? { ...p, gpsLat: lat, gpsLng: lng } : p)));
        setToast(`Plot ${plot.plotNumber} relocated`);
      } else if (res.status === 401 || res.status === 403) {
        setToast("No permission to move plots");
        fetchPlots();
      } else {
        setToast("Failed to relocate");
        fetchPlots();
      }
    } catch (err) {
      console.error(err);
      setToast("Failed to relocate");
      fetchPlots();
    }
  }

  const detailsDestination =
    activeDetailsPlot && hasGps(activeDetailsPlot) ? { lat: Number(activeDetailsPlot.gpsLat), lng: Number(activeDetailsPlot.gpsLng) } : activeDetailsPlot ? { lat: NaN, lng: NaN } : null;

  return (
    <div style={isFullScreen ? { display: "flex", flexDirection: "column", height: "100%", flex: 1, minHeight: 0 } : undefined}>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Cemetery Map</h1>
          <p className="page-subtitle">
            {isAdmin ? "Add plot markers, drag to relocate, and navigate" : "Interactive navigation with grave markers (powered by Google Maps)"}
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-sm" style={{ flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-secondary flex items-center gap-xs"
            onClick={handleLocateCemetery}
            title={`Recenter map on ${SITE_NAME}`}
          >
            <Compass size={16} /> Locate Cemetery
          </button>

          {isAdmin && (
            <>
              {unpinned.length > 0 && !pending && !editing && (
                <button className="btn btn-ghost btn-sm flex items-center gap-xs" onClick={() => setUnplacedOpen(true)}>
                  <MapPinOff size={16} /> Unplaced ({unpinned.length})
                </button>
              )}
              <button className="btn btn-primary flex items-center gap-xs" onClick={openAdd} disabled={editing || !!pending}>
                <Plus size={18} /> Add Plot
              </button>
              <button
                className={`btn ${editing ? "" : "btn-ghost"} flex items-center gap-xs`}
                onClick={toggleEditing}
                disabled={!!pending || adjustMode}
                style={editing ? { background: "var(--success, #2ECC71)", color: "#fff" } : undefined}
              >
                {editing ? <><Check size={18} /> Done Editing</> : <><Pencil size={16} /> Edit Locations</>}
              </button>
              <button
                className={`btn ${adjustMode ? "" : "btn-secondary"} flex items-center gap-xs`}
                onClick={toggleAdjustMode}
                disabled={!!pending || editing}
                style={adjustMode ? { background: "#0284c7", color: "#fff", borderColor: "#38bdf8" } : undefined}
                title="Adjust plot positions like cropping/moving an image"
              >
                <Move size={16} />
                <span>{adjustMode ? "Exit Adjust Mode" : "Adjust Grid (Crop & Move)"}</span>
              </button>
            </>
          )}

          {/* Full Screen Mode Toggle Button */}
          <button
            type="button"
            className={`btn ${isFullScreen ? "" : "btn-secondary"} flex items-center gap-xs`}
            onClick={() => setIsFullScreen((prev) => !prev)}
            title={isFullScreen ? "Exit Full Screen view (Esc)" : "Full Screen view (hide sidebar and header)"}
            style={
              isFullScreen
                ? { background: "#4f46e5", borderColor: "#6366f1", color: "#fff", fontWeight: 600 }
                : undefined
            }
          >
            {isFullScreen ? (
              <>
                <Minimize2 size={16} /> Exit Full Screen
              </>
            ) : (
              <>
                <Maximize2 size={16} /> Full Screen
              </>
            )}
          </button>
        </div>
      </div>

      {/* Mode banners */}
      {pending && (
        <div className="alert" style={{ marginBottom: "var(--space-md)", display: "flex", alignItems: "center", gap: "var(--space-sm)", background: "var(--primary-light, #eef4ff)", padding: "0.75rem 1rem", borderRadius: "var(--radius-md)", flexWrap: "wrap" }}>
          <Crosshair size={18} />
          <span className="text-sm">
            {draftCoords
              ? `${pending.isNew ? "New plot" : "Plot"} ${pending.plotNumber}: drag the pin or click the map to fine-tune, then Save.`
              : `Click on the map to place ${pending.isNew ? "new plot" : "plot"} ${pending.plotNumber} — you can drag it afterward.`}
          </span>
          {error && <span className="text-sm" style={{ color: "var(--danger)", display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={14} /> {error}</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-sm)" }}>
            <button className="btn btn-ghost btn-sm" onClick={resetModes} disabled={saving}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={savePlacement} disabled={saving || !draftCoords}>
              {saving ? "Saving..." : pending.isNew ? "Save Plot" : "Save Location"}
            </button>
          </span>
        </div>
      )}

      {editing && (
        <div
          className="alert alert-info flex items-center gap-sm"
          style={{
            marginBottom: "var(--space-md)",
            background: "rgba(14, 165, 233, 0.08)",
            borderColor: "rgba(14, 165, 233, 0.28)",
          }}
        >
          <Pencil size={16} style={{ color: "#0284c7", flexShrink: 0 }} />
          <span className="text-sm" style={{ color: "var(--color-text-secondary, #334155)" }}>
            <strong style={{ color: "var(--color-text-primary, #0f172a)" }}>Edit mode:</strong> drag any plot marker to relocate it — changes save automatically. Click “Done Editing” when finished.
          </span>
        </div>
      )}

      {adjustMode && (
        <div
          className="alert alert-info flex items-center gap-sm"
          style={{
            marginBottom: "var(--space-md)",
            background: "rgba(14, 165, 233, 0.08)",
            borderColor: "rgba(14, 165, 233, 0.3)",
          }}
        >
          <Move size={16} style={{ color: "#0284c7", flexShrink: 0 }} />
          <span className="text-sm" style={{ color: "var(--color-text-secondary, #334155)" }}>
            <strong style={{ color: "var(--color-text-primary, #0f172a)" }}>Crop / Adjust Mode:</strong> Drag the central cyan{" "}
            <strong style={{ color: "#0284c7" }}>✥ MOVE</strong> anchor to slide the plot grid, or use the D-pad arrows to nudge by 0.1m / 0.5m. Click{" "}
            <strong style={{ color: "var(--accent-dark, #059669)" }}>Save</strong> when plots line up with the concrete roofs.
          </span>
        </div>
      )}

      {/* Map (full width with digital mapping layout) */}
      <div
        id="cemetery-map-container"
        style={{
          height: isFullScreen ? "100%" : "calc(100vh - 190px)",
          flex: isFullScreen ? 1 : undefined,
          minHeight: isFullScreen ? 0 : 660,
          position: "relative",
          borderRadius: "var(--radius-lg, 12px)",
          overflow: "hidden",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        }}
      >
        {/* Slide-out Plot Details Drawer */}
        <PlotDetailsDrawer
          plot={activeDetailsPlot}
          allPlots={plots}
          isOpen={Boolean(!pending && !editing && !adjustMode)}
          isCollapsed={drawerCollapsed}
          onToggleCollapse={() => setDrawerCollapsed((prev) => !prev)}
          onClose={() => {
            setDetailsPlot(null);
            setDrawerCollapsed(true);
            // The route belongs to the plot shown in the drawer; it goes with it.
            setRouteCoords(null);
          }}
          onSelectPlot={(plot) => {
            setRouteCoords(null);
            setDetailsPlot(plot);
            if (plot) setDrawerCollapsed(false);
          }}
          onRouteChange={setRouteCoords}
          onRelocatePlot={(plot) => startPlacing(plot)}
          onUpdatePlot={(updatedPlot) => {
            setDetailsPlot(updatedPlot);
            setPlots((prev) => prev.map((p) => (p.id === updatedPlot.id ? updatedPlot : p)));
            fetchPlots();
          }}
          activeRoute={Boolean(routeCoords && routeCoords.length > 1)}
          isAdmin={isAdmin}
          authenticated={Boolean(session?.user)}
        />

        {/* Plot Position Adjuster Toolbar (Crop / Transform HUD) */}
        <PlotPositionAdjuster
          active={adjustMode}
          onClose={() => {
            if (plots.some((p) => p._modified)) {
              handleCancelAdjust();
            } else {
              setAdjustMode(false);
              setEditBoundaryLines(false);
              setBuildingConfig((prev) => ({ ...prev, active: false }));
            }
          }}
          onCancel={handleCancelAdjust}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          plots={plots}
          onUpdatePlots={handleUpdatePlotsWithHistory}
          onSave={handleSaveBatchPlots}
          onPresetSuccess={handlePresetSuccess}
          saving={savingBatch}
          selectedScope={selectedScope}
          onSelectScope={setSelectedScope}
          gridAngle={gridAngle}
          onChangeGridAngle={(newAngleOrUpdater) => {
            const nextAngle = typeof newAngleOrUpdater === "function" ? newAngleOrUpdater(gridAngle) : newAngleOrUpdater;
            setGridAngle(nextAngle);
            pushHistory(plots, nextAngle);
          }}
          boundaryOffsets={effectiveBoundaryOffsets}
          onUpdateBoundaryOffsets={handleUpdateBoundaryOffsets}
          editBoundaryLines={editBoundaryLines}
          onToggleEditBoundaryLines={() => setEditBoundaryLines((prev) => !prev)}
          onResetBoundary={handleResetBoundary}
          buildingConfig={buildingConfig}
          onUpdateBuildingConfig={setBuildingConfig}
          activeTab={adjusterTab}
          onTabChange={setAdjusterTab}
          confirmDeleteRow={confirmDeleteRow}
          onConfirmDeleteRow={setConfirmDeleteRow}
        />

        <CemeteryMapView
          layoutTools={adjustMode || editing || !!pending}
          plots={plots}
          selectedPlot={activeDetailsPlot}
          onSelectPlot={(plot) => {
            if (pending || editing || adjustMode) return;
            // The 3D map can offer a layout cell that is not a saved plot yet.
            if (plot && plot.id == null) return;
            setRouteCoords(null);
            setDetailsPlot(plot);
            if (plot) setDrawerCollapsed(false);
          }}
          routeCoords={routeCoords}
          placingMode={!!pending}
          draftMarker={draftMarker}
          onMapClick={handleMapClick}
          focusPoint={focusPoint}
          editable={editing}
          onPlotDragEnd={handlePlotDragEnd}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          adjustMode={adjustMode}
          onToggleAdjustMode={toggleAdjustMode}
          selectedScope={selectedScope}
          onSelectScope={setSelectedScope}
          onUpdatePlots={handleUpdatePlotsWithHistory}
          gridAngle={gridAngle}
          onChangeGridAngle={(newAngleOrUpdater) => {
            const nextAngle = typeof newAngleOrUpdater === "function" ? newAngleOrUpdater(gridAngle) : newAngleOrUpdater;
            setGridAngle(nextAngle);
            pushHistory(plots, nextAngle);
          }}
          onSinglePlotDrag={handleSinglePlotDrag}
          boundaryOffsets={effectiveBoundaryOffsets}
          onUpdateBoundaryOffsets={handleUpdateBoundaryOffsets}
          editBoundaryLines={editBoundaryLines}
          buildingConfig={buildingConfig}
          buildingToolOpen={adjusterTab === "building"}
          onUpdateBuildingConfig={setBuildingConfig}
          onApplyBuildingConfig={handleApplyAndSaveBuildingConfig}
        />

        {toast && (
          <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "var(--primary)", color: "#ffffff", padding: "0.5rem 1rem", borderRadius: "var(--radius-md)", zIndex: 500, fontSize: "0.85rem", fontWeight: 500, whiteSpace: "nowrap", boxShadow: "0 4px 15px rgba(0,0,0,0.4)" }}>
            {toast}
          </div>
        )}
      </div>

      {/* Add Plot metadata modal */}
      {addOpen && (
        <Modal
          title="Add Plot"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={proceedAddToMap} disabled={!addForm.locationDetailId}>
                Place on Map
              </button>
            </>
          }
        >
          <form onSubmit={proceedAddToMap} className="flex flex-col gap-lg">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Location / Section</label>
              <select
                className="form-select"
                value={addForm.locationDetailId}
                onChange={(e) => {
                  const locationDetailId = e.target.value;
                  setAddForm({ locationDetailId, plotNumber: locationDetailId ? nextPlotNumber(locationDetailId) : "" });
                }}
                required
                style={{ width: "100%" }}
              >
                <option value="">Select a section...</option>
                {locations.map((loc) => (
                  <optgroup key={loc.id} label={loc.name}>
                    {loc.details?.map((det) => (
                      <option key={det.id} value={det.id}>{blockFullLabel(det.subsection)} (Capacity: {det.capacity})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Plot Number</span>
                <span className="text-xs text-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: "0" }}>(Assigned automatically)</span>
              </label>
              <div className="form-input" style={{ display: "flex", alignItems: "center", background: "rgba(0,0,0,0.1)", border: "1px dashed var(--border-default)", color: addForm.plotNumber ? "var(--text-primary)" : "var(--text-muted)", fontFamily: "var(--font-mono)", width: "100%", height: "42px" }}>
                {addForm.plotNumber || "Select a section first"}
              </div>
            </div>
            <div className="text-center text-muted" style={{ marginTop: "var(--space-sm)" }}>
              <p className="text-sm" style={{ lineHeight: 1.5, margin: 0 }}>
                Click <strong>Place on Map</strong> and you will then drop a marker on the map and drag it to fine-tune the exact location before saving.
              </p>
            </div>
          </form>
        </Modal>
      )}

      {/* Unplaced plots modal */}
      {unplacedOpen && (
        <Modal title={`Unplaced plots (${unpinned.length})`} onClose={() => setUnplacedOpen(false)}>
          <p className="text-sm text-muted" style={{ marginBottom: "var(--space-sm)" }}>
            These plots have no GPS location yet. Pick one, then drop its marker on the map.
          </p>
          <div className="flex flex-col gap-xs" style={{ maxHeight: 360, overflowY: "auto" }}>
            {unpinned.length === 0 && <div className="text-sm text-muted">All plots have a location. 🎉</div>}
            {unpinned.map((p) => (
              <button
                key={p.id}
                className="btn btn-ghost btn-sm flex items-center justify-between"
                onClick={() => { setUnplacedOpen(false); startPlacing(p); }}
                style={{ width: "100%", textAlign: "left" }}
              >
                <span>
                  <strong>{p.plotNumber}</strong>
                  <span className="text-xs text-muted"> — {p.locationDetail?.location?.name || "—"}{p.locationDetail?.subsection ? ` / ${p.locationDetail.subsection}` : ""}</span>
                </span>
                <Crosshair size={14} />
              </button>
            ))}
          </div>
        </Modal>
      )}

    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<div className="spinner spinner-lg" />}>
      <MapPageInner />
    </Suspense>
  );
}
