"use client";

import { useCallback, useEffect, useMemo, useState, useRef, Fragment } from "react";
import {
  GoogleMap,
  MarkerF,
  PolylineF,
  PolygonF,
  InfoWindowF,
  CircleF,
  useJsApiLoader,
} from "@react-google-maps/api";
import { AlertTriangle } from "lucide-react";
import MapModeSwitch from "@/components/map/MapModeSwitch";
import MapTypeControl from "@/components/map/MapTypeControl";
import MapLoading from "@/components/map/MapLoading";
import BlockTypeLegend from "@/components/map/BlockTypeLegend";
import MapStatusKey from "@/components/map/MapStatusKey";
import { getClientMapCenter, getClientGoogleMapsApiKey } from "../lib/config";
import {
  getPlotStatusColor,
  getPlotCorners,
  getBoundaryCoords,
  getBuildingsCenter,
  deriveBoundaryOffsets,
  coordsToBoundaryOffsets,
  splitCellAcross,
} from "@/lib/map-geometry";
import {
  belongsToBuilding,
  columnShortLabel,
  compareByColumn,
  getBuildingKey,
  isBuildingPlot,
} from "@/lib/cemetery-layout";
import { DEFAULT_GRID_ANGLE_DEG } from "@/lib/config";
import { siteBoundaryOffsets, siteOverlay } from "@/lib/site-overlay";
import { installMapsAuthFailureHandler, useMapsAuthFailed } from "@/lib/maps-auth";
import { MapUnavailable } from "@/components/map/MapUnavailable";
import {
  getBuildingMoveAnchorIcon,
  getBuildingLengthHandleIcon,
  getBuildingWidthHandleIcon,
  getBuildingRotateHandleIcon,
  getBuildingApplyHandleIcon,
  getBlockTitleBadgeIcon,
  getSiteLabelIcon,
  BLUE_PIN_ICON,
  WALKER_PIN_ICON,
  createPlotLabelIcon,
  circleSymbol,
  draftSymbol,
  getMoveAnchorIcon,
  getRotateHandleIcon,
} from "./map/map-icons";
import {
  getPlotOccupantNames,
  getPlotSummaryNames,
  mapPlotStatus,
  matchesStatusFilter,
  tierOccupancy,
} from "@/lib/plot-format";
import { getPlotsBoundingBox, translatePlots, rotatePlots, M_TO_LAT } from "@/lib/geo";
import {
  localOffsetToLatLng,
  latLngToLocalOffset,
  getBuildingCorners,
  getSubdividedBuildingCells,
  snapBuildingToPlots,
} from "../lib/building-grid";

const WRAPPER_STYLE = {
  position: "relative",
  width: "100%",
  height: "100%",
  borderRadius: "var(--radius-md, 10px)",
  overflow: "hidden",
};
const CONTAINER_STYLE = { width: "100%", height: "100%" };

// Must be in place before the Maps script runs, so Google reports a rejected
// API key to us instead of only drawing its own error box.
if (typeof window !== "undefined") installMapsAuthFailureHandler(window);

const BASE_OPTIONS = {
  mapTypeId: "hybrid",
  zoom: 20,
  disableDefaultUI: false,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  zoomControl: true,
  gestureHandling: "greedy",
  clickableIcons: false,
  maxZoom: 24,
};

// Room left around a fitted route: the dashboard overlays a ~360px panel on
// the left of the map, so leave that side clear by default.
const ROUTE_FIT_PADDING = { top: 70, right: 60, bottom: 80, left: 380 };

function GoogleMapLoadedView({
  apiKey,
  plots = [],
  selectedPlot,
  onSelectPlot,
  routeCoords,
  routeFitPadding = ROUTE_FIT_PADDING,
  placingMode = false,
  draftMarker = null,
  onMapClick,
  focusPoint = null,
  editable = false,
  onPlotDragEnd,
  statusFilter = "all",
  onStatusFilterChange,
  adjustMode = false,
  onToggleAdjustMode,
  selectedScope = "all",
  onSelectScope,
  onUpdatePlots,
  gridAngle = DEFAULT_GRID_ANGLE_DEG,
  onChangeGridAngle,
  onSinglePlotDrag,
  onLandmarkDragEnd,
  boundaryOffsets = null,
  onUpdateBoundaryOffsets,
  editBoundaryLines = false,
  buildingConfig = null,
  buildingToolOpen = false,
  onUpdateBuildingConfig,
  onApplyBuildingConfig,
  // Plot-picker support (both optional): plots listed here are drawn dimmed
  // (they cannot take a record), and `fitPlots` frames every plot on load.
  dimmedPlotIds = null,
  fitPlots = false,
  // The status legend doubles as a filter for staff; the kiosk hides it.
  showLegend = true,
  // Set by CemeteryMapView: shows a "3D" button that switches to the 3D map.
  onMapModeChange,
  // The visitor's live GPS position ({ lat, lng, accuracy }); moves "You're here".
  userPosition = null,
}) {
  const { lat, lng } = getClientMapCenter();
  const center = useMemo(() => ({ lat, lng }), [lat, lng]);

  // NOTE: with the async bootstrap loader, `window.google.maps` exists as a
  // stub (only `importLibrary`) before the Maps library is ready. Checking a
  // real constructor avoids rendering <GoogleMap> before `google.maps.Map`
  // exists, which crashed with "google.maps.Map is not a constructor".
  const isGoogleAlreadyLoaded =
    typeof window !== "undefined" && typeof window.google?.maps?.Map === "function";
  const { isLoaded: scriptLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: apiKey,
  });
  const isLoaded = isGoogleAlreadyLoaded || scriptLoaded;
  const mapsAuthFailed = useMapsAuthFailed();

  const [map, setMap] = useState(null);
  // Becomes true only when the Google "maps" library is fully constructed
  // (google.maps.Point / Size / SymbolPath available). Building marker icons
  // before this crashes with "window.google.maps.Point is not a constructor".
  const [mapsReady, setMapsReady] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(20);
  const [hoveredPlot, setHoveredPlot] = useState(null);
  const [mapTypeId, setMapTypeId] = useState("hybrid");
  // On phones the status key starts collapsed to a "Key" button so it does not cover the map.
  const [isPhone, setIsPhone] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => {
      setIsPhone(mq.matches);
      setLegendOpen(!mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const [activeFilter, setActiveFilter] = useState("all");

  const effectiveFilter = statusFilter !== "all" ? statusFilter : activeFilter;

  const dimmed = useMemo(
    () => (dimmedPlotIds instanceof Set ? dimmedPlotIds : new Set(dimmedPlotIds || [])),
    [dimmedPlotIds]
  );

  // Frame every pinned plot once the map is ready (used by the plot picker).
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!fitPlots || !map || !mapsReady || fittedRef.current) return;
    const pinned = plots.filter((p) => !p._deleted && p.gpsLat != null && p.gpsLng != null);
    if (pinned.length === 0) return;
    const bounds = new window.google.maps.LatLngBounds();
    for (const p of pinned) bounds.extend({ lat: Number(p.gpsLat), lng: Number(p.gpsLng) });
    fittedRef.current = true;
    map.fitBounds(bounds, 48);
  }, [fitPlots, map, mapsReady, plots]);

  // The building generator (handles, Apply & Save) is live only while its
  // adjuster tab is open, so a stray click on a building outline never pops it.
  const buildingActive = Boolean(buildingConfig?.active) && buildingToolOpen;

  // Scope filter for adjust / crop mode
  const scopeFilter = useCallback(
    (p) => {
      if (!isBuildingPlot(p)) return false;
      return selectedScope === "all" || belongsToBuilding(p, selectedScope);
    },
    [selectedScope]
  );

  // Bounding box of the plots currently in scope
  const adjustBbox = useMemo(() => {
    if (!adjustMode) return null;
    return getPlotsBoundingBox(plots, scopeFilter);
  }, [adjustMode, plots, scopeFilter]);

  // Center anchor tracking for live dragging
  const anchorPos = useMemo(() => {
    if (!adjustBbox) return null;
    return { lat: adjustBbox.centerLat, lng: adjustBbox.centerLng };
  }, [adjustBbox]);

  const lastAnchorPosRef = useRef(null);

  useEffect(() => {
    lastAnchorPosRef.current = anchorPos;
  }, [anchorPos]);

  const handleAnchorDrag = useCallback(
    (e) => {
      if (!e.latLng || !lastAnchorPosRef.current || !onUpdatePlots) return;
      const curLat = e.latLng.lat();
      const curLng = e.latLng.lng();
      const dLat = curLat - lastAnchorPosRef.current.lat;
      const dLng = curLng - lastAnchorPosRef.current.lng;
      lastAnchorPosRef.current = { lat: curLat, lng: curLng };
      const updated = translatePlots(plots, dLat, dLng, scopeFilter);
      onUpdatePlots(updated);
    },
    [plots, scopeFilter, onUpdatePlots]
  );

  const handleAnchorDragEnd = useCallback(
    (e) => {
      if (!e.latLng || !lastAnchorPosRef.current || !onUpdatePlots) return;
      const curLat = e.latLng.lat();
      const curLng = e.latLng.lng();
      const dLat = curLat - lastAnchorPosRef.current.lat;
      const dLng = curLng - lastAnchorPosRef.current.lng;
      lastAnchorPosRef.current = { lat: curLat, lng: curLng };
      const updated = translatePlots(plots, dLat, dLng, scopeFilter);
      onUpdatePlots(updated);
    },
    [plots, scopeFilter, onUpdatePlots]
  );

  // Rotate handle dragging
  const handleRotateDrag = useCallback(
    (e) => {
      if (!e.latLng || !adjustBbox || !onUpdatePlots) return;
      const curLat = e.latLng.lat();
      const curLng = e.latLng.lng();
      const cLat = adjustBbox.centerLat;
      const cLng = adjustBbox.centerLng;

      const dy = (curLat - cLat) * 110574;
      const dx = (curLng - cLng) * 111320 * Math.cos((cLat * Math.PI) / 180);
      const angleRad = Math.atan2(dx, dy);
      const angleDegDelta = (angleRad * 180) / Math.PI;

      if (Math.abs(angleDegDelta) > 0.3) {
        const step = angleDegDelta > 0 ? 0.3 : -0.3;
        const updated = rotatePlots(plots, cLat, cLng, step, scopeFilter);
        onUpdatePlots(updated);
        if (typeof onChangeGridAngle === "function") {
          onChangeGridAngle((prev) => Number((prev + step).toFixed(1)));
        }
      }
    },
    [adjustBbox, plots, scopeFilter, onUpdatePlots, onChangeGridAngle]
  );

  // ─── Group all row plots into building blocks ───
  const rowPlotMap = useMemo(() => {
    const map = new Map();
    for (const p of plots) {
      if (!p.gpsLat || !p.gpsLng || p._deleted) continue;
      const r = getBuildingKey(p);
      if (r) {
        if (!map.has(r)) map.set(r, []);
        map.get(r).push(p);
      }
    }
    return map;
  }, [plots]);

  const allBuildingBlocks = useMemo(() => {
    const blocks = [];
    const rowKeys = Array.from(rowPlotMap.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );

    for (const r of rowKeys) {
      const rowPlots = rowPlotMap.get(r).slice().sort(compareByColumn);

      const isTargetActive = Boolean(
        buildingActive &&
        buildingConfig.targetRow === r
      );

      let cfg;
      if (isTargetActive) {
        cfg = {
          centerLat: buildingConfig.centerLat,
          centerLng: buildingConfig.centerLng,
          lengthMeters: buildingConfig.lengthMeters,
          widthMeters: buildingConfig.widthMeters,
          angleDeg: buildingConfig.angleDeg,
          numCols: buildingConfig.numCols,
          numRows: buildingConfig.numRows,
          invertCols: buildingConfig.invertCols,
        };
      } else {
        const snapped = snapBuildingToPlots(rowPlots, gridAngle ?? DEFAULT_GRID_ANGLE_DEG);
        if (!snapped) continue;
        cfg = {
          centerLat: snapped.centerLat,
          centerLng: snapped.centerLng,
          lengthMeters: snapped.lengthMeters,
          widthMeters: snapped.widthMeters,
          angleDeg: snapped.angleDeg,
          // Two rows (front and back faces) for a back-to-back block.
          numCols: snapped.numCols,
          numRows: snapped.numRows,
          invertCols: false,
        };
      }

      const corners = getBuildingCorners(cfg);
      const cells = getSubdividedBuildingCells({
        ...cfg,
        targetPlots: rowPlots,
        targetRow: r,
      });

      blocks.push({
        rowKey: r,
        isTargetActive,
        cfg,
        corners,
        cells,
        plots: rowPlots,
      });
    }

    // Custom freeform block support if active
    if (buildingActive && buildingConfig.targetRow === "custom") {
      const corners = getBuildingCorners(buildingConfig);
      const cells = getSubdividedBuildingCells({
        ...buildingConfig,
        targetPlots: [],
      });
      blocks.push({
        rowKey: "custom",
        isTargetActive: true,
        cfg: buildingConfig,
        corners,
        cells,
        plots: [],
      });
    }

    return blocks;
  }, [rowPlotMap, buildingConfig, buildingActive, gridAngle]);

  // Edge anchor points on the building perimeter
  const buildingTopEdgePos = useMemo(() => {
    if (!buildingActive) return null;
    return localOffsetToLatLng(
      0,
      buildingConfig.widthMeters / 2,
      buildingConfig.centerLat,
      buildingConfig.centerLng,
      buildingConfig.angleDeg
    );
  }, [buildingConfig, buildingActive]);

  const buildingBottomEdgePos = useMemo(() => {
    if (!buildingActive) return null;
    return localOffsetToLatLng(
      0,
      -buildingConfig.widthMeters / 2,
      buildingConfig.centerLat,
      buildingConfig.centerLng,
      buildingConfig.angleDeg
    );
  }, [buildingConfig, buildingActive]);

  const buildingRightEdgePos = useMemo(() => {
    if (!buildingActive) return null;
    return localOffsetToLatLng(
      buildingConfig.lengthMeters / 2,
      0,
      buildingConfig.centerLat,
      buildingConfig.centerLng,
      buildingConfig.angleDeg
    );
  }, [buildingConfig, buildingActive]);

  // Extended handle positions (cleanly separated in 4 cardinal directions)
  const buildingRotateHandlePos = useMemo(() => {
    if (!buildingActive) return null;
    return localOffsetToLatLng(
      0,
      buildingConfig.widthMeters / 2 + 7.5,
      buildingConfig.centerLat,
      buildingConfig.centerLng,
      buildingConfig.angleDeg
    );
  }, [buildingConfig, buildingActive]);

  const buildingWidthHandlePos = useMemo(() => {
    if (!buildingActive) return null;
    return localOffsetToLatLng(
      0,
      -(buildingConfig.widthMeters / 2 + 4.5),
      buildingConfig.centerLat,
      buildingConfig.centerLng,
      buildingConfig.angleDeg
    );
  }, [buildingConfig, buildingActive]);

  const buildingLengthHandlePos = useMemo(() => {
    if (!buildingActive) return null;
    return localOffsetToLatLng(
      buildingConfig.lengthMeters / 2 + 4.5,
      0,
      buildingConfig.centerLat,
      buildingConfig.centerLng,
      buildingConfig.angleDeg
    );
  }, [buildingConfig, buildingActive]);

  const buildingLeftEdgePos = useMemo(() => {
    if (!buildingActive) return null;
    return localOffsetToLatLng(
      -buildingConfig.lengthMeters / 2,
      0,
      buildingConfig.centerLat,
      buildingConfig.centerLng,
      buildingConfig.angleDeg
    );
  }, [buildingConfig, buildingActive]);

  const buildingApplyHandlePos = useMemo(() => {
    if (!buildingActive) return null;
    return localOffsetToLatLng(
      -(buildingConfig.lengthMeters / 2 + 5.0),
      0,
      buildingConfig.centerLat,
      buildingConfig.centerLng,
      buildingConfig.angleDeg
    );
  }, [buildingConfig, buildingActive]);

  const handleBuildingAnchorDrag = useCallback(
    (e) => {
      if (!e.latLng || !onUpdateBuildingConfig) return;
      const lat = Number(e.latLng.lat().toFixed(8));
      const lng = Number(e.latLng.lng().toFixed(8));
      onUpdateBuildingConfig((prev) => ({
        ...prev,
        centerLat: lat,
        centerLng: lng,
      }));
    },
    [onUpdateBuildingConfig]
  );

  const handleBuildingLengthDrag = useCallback(
    (e) => {
      if (!e.latLng || !buildingConfig || !onUpdateBuildingConfig) return;
      const { centerLat, centerLng, angleDeg } = buildingConfig;
      const { dx } = latLngToLocalOffset(e.latLng.lat(), e.latLng.lng(), centerLat, centerLng, angleDeg);
      const rawHalf = Math.max(1.5, Math.abs(dx) - 4.5);
      const newLen = Math.max(3.0, Math.min(120.0, Number((rawHalf * 2).toFixed(1))));
      onUpdateBuildingConfig((prev) => ({
        ...prev,
        lengthMeters: newLen,
      }));
    },
    [buildingConfig, onUpdateBuildingConfig]
  );

  const handleBuildingWidthDrag = useCallback(
    (e) => {
      if (!e.latLng || !buildingConfig || !onUpdateBuildingConfig) return;
      const { centerLat, centerLng, angleDeg } = buildingConfig;
      const { dy } = latLngToLocalOffset(e.latLng.lat(), e.latLng.lng(), centerLat, centerLng, angleDeg);
      const rawHalf = Math.max(0.5, Math.abs(dy) - 4.5);
      const newWid = Math.max(1.0, Math.min(30.0, Number((rawHalf * 2).toFixed(1))));
      onUpdateBuildingConfig((prev) => ({
        ...prev,
        widthMeters: newWid,
      }));
    },
    [buildingConfig, onUpdateBuildingConfig]
  );

  const handleBuildingRotateDrag = useCallback(
    (e) => {
      if (!e.latLng || !buildingConfig || !onUpdateBuildingConfig) return;
      const { centerLat, centerLng } = buildingConfig;
      const dLatMeters = (e.latLng.lat() - centerLat) * 110574;
      const dLngMeters = (e.latLng.lng() - centerLng) * 111320 * Math.cos((centerLat * Math.PI) / 180);
      const angleRad = -Math.atan2(dLngMeters, dLatMeters);
      let newAngle = (angleRad * 180) / Math.PI;
      if (newAngle < 0) newAngle += 360;
      onUpdateBuildingConfig((prev) => ({
        ...prev,
        angleDeg: Number(newAngle.toFixed(1)),
      }));
    },
    [buildingConfig, onUpdateBuildingConfig]
  );
  const onLoad = useCallback((instance) => {
    setMap(instance);
    setZoomLevel(instance.getZoom() || 20);
    setMapsReady(true);
  }, []);

  const onUnmount = useCallback(() => {
    setMap(null);
    setMapsReady(false);
  }, []);

  // Update zoom level state on zoom_changed (only on meaningful change to avoid render loops)
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("zoom_changed", () => {
      const z = map.getZoom();
      if (typeof z === "number") {
        setZoomLevel((prev) => (Math.abs(prev - z) >= 0.2 ? z : prev));
      }
    });
    return () => {
      if (window.google?.maps?.event) {
        window.google.maps.event.removeListener(listener);
      }
    };
  }, [map]);

  const lastFocusPosRef = useRef(null);

  // Smoothly recenter when focusPoint changes
  useEffect(() => {
    if (!map || !focusPoint) return;
    if (Number.isFinite(focusPoint.lat) && Number.isFinite(focusPoint.lng)) {
      const prev = lastFocusPosRef.current;
      if (prev && Math.abs(prev.lat - focusPoint.lat) < 1e-6 && Math.abs(prev.lng - focusPoint.lng) < 1e-6) {
        return;
      }
      lastFocusPosRef.current = { lat: focusPoint.lat, lng: focusPoint.lng };
      map.panTo({ lat: focusPoint.lat, lng: focusPoint.lng });
      const currentZoom = map.getZoom() || 0;
      if (currentZoom < 20) {
        map.setZoom(20);
      }
    }
  }, [focusPoint, map]);

  // Sync mapTypeId directly to the Google Map instance
  useEffect(() => {
    if (map && mapTypeId) {
      try {
        map.setMapTypeId(mapTypeId);
      } catch {
        // ignore
      }
    }
  }, [map, mapTypeId]);

  // Route polyline
  const routePath = useMemo(
    () =>
      Array.isArray(routeCoords)
        ? routeCoords
            .filter((c) => Array.isArray(c) && c.length === 2)
            .map(([cLat, cLng]) => ({ lat: Number(cLat), lng: Number(cLng) }))
        : [],
    [routeCoords]
  );

  // Route is [origin, ...road..., plot]: the first and last segments are the
  // off-road walks to/from the nearest road, drawn dashed; the rest is solid.
  const routeSegments = useMemo(() => {
    if (routePath.length < 4) return { road: routePath, connectors: [] };
    const last = routePath.length - 1;
    return {
      road: routePath.slice(1, last),
      connectors: [
        [routePath[0], routePath[1]],
        [routePath[last - 1], routePath[last]],
      ],
    };
  }, [routePath]);

  useEffect(() => {
    if (!map || !window.google?.maps || routePath.length < 2) return;
    try {
      const bounds = new window.google.maps.LatLngBounds();
      routePath.forEach((pt) => bounds.extend(pt));
      map.fitBounds(bounds, routeFitPadding);
    } catch {
      // ignore
    }
    // routeFitPadding is a static layout hint; refit only for a new route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, routePath]);

  const handleMapClick = useCallback(
    (event) => {
      if (placingMode && typeof onMapClick === "function" && event.latLng) {
        onMapClick(event.latLng.lat(), event.latLng.lng());
      }
    },
    [placingMode, onMapClick]
  );

  // Google's own buttons (zoom, recentre) grow on 2K / 4K screens, like ours.
  const [controlSize, setControlSize] = useState(undefined);
  useEffect(() => {
    const big = window.matchMedia("(min-width: 2400px)");
    const huge = window.matchMedia("(min-width: 3200px)");
    const apply = () => setControlSize(huge.matches ? 70 : big.matches ? 50 : undefined);
    apply();
    big.addEventListener("change", apply);
    huge.addEventListener("change", apply);
    return () => {
      big.removeEventListener("change", apply);
      huge.removeEventListener("change", apply);
    };
  }, []);

  // The directory blocks with no plots yet and the buildings — the same ones
  // the 3D map draws — so both maps show the whole park.
  const site = useMemo(() => siteOverlay({ plots, gridAngle: gridAngle ?? DEFAULT_GRID_ANGLE_DEG }), [plots, gridAngle]);

  const options = useMemo(
    () => ({
      ...BASE_OPTIONS,
      mapTypeId,
      draggableCursor: placingMode ? "crosshair" : undefined,
      ...(controlSize ? { controlSize } : {}),
    }),
    [placingMode, mapTypeId, controlSize]
  );

  // Centre of the building plots (the configured map centre when there are none).
  const buildingsCenter = useMemo(
    () => getBuildingsCenter(plots) ?? { lat: center.lat, lng: center.lng },
    [plots, center.lat, center.lng]
  );

  // Saved boundary offsets, else a padded rectangle derived from the buildings.
  const effectiveBoundaryOffsets = useMemo(() => {
    if (Array.isArray(boundaryOffsets) && boundaryOffsets.length >= 3) return boundaryOffsets;
    // Unsaved: the cemetery's own outline (the paved yard, as on the 3D map);
    // without one, a rectangle round the rows and the blocks not mapped yet.
    return (
      siteBoundaryOffsets(plots, gridAngle ?? DEFAULT_GRID_ANGLE_DEG) ??
      deriveBoundaryOffsets(plots, gridAngle ?? DEFAULT_GRID_ANGLE_DEG, 8, site.blocks.flatMap((b) => b.path))
    );
  }, [boundaryOffsets, plots, gridAngle, site.blocks]);

  // Boundary coordinates that move & rotate in lockstep with the plots
  const boundaryPaths = useMemo(
    () =>
      getBoundaryCoords(
        buildingsCenter.lat,
        buildingsCenter.lng,
        gridAngle ?? DEFAULT_GRID_ANGLE_DEG,
        effectiveBoundaryOffsets
      ),
    [buildingsCenter.lat, buildingsCenter.lng, gridAngle, effectiveBoundaryOffsets]
  );

  const polygonRef = useRef(null);

  // Sync edits from the map to state — only when user is actively editing boundary lines
  const handlePolygonPathChange = useCallback(() => {
    if (!polygonRef.current || !onUpdateBoundaryOffsets || !editBoundaryLines) return;
    const path = polygonRef.current.getPath();
    if (!path || path.getLength() === 0) return;
    const newCoords = [];
    for (let i = 0; i < path.getLength(); i++) {
      const pt = path.getAt(i);
      newCoords.push({ lat: pt.lat(), lng: pt.lng() });
    }
    const newOffsets = coordsToBoundaryOffsets(
      newCoords,
      buildingsCenter.lat,
      buildingsCenter.lng,
      gridAngle ?? DEFAULT_GRID_ANGLE_DEG
    );

    // Guard against recursive state update loops: only update if offsets actually changed significantly (> 5cm)
    const currentOffsets = effectiveBoundaryOffsets || [];
    const hasMeaningfulChange =
      newOffsets.length !== currentOffsets.length ||
      newOffsets.some((o, idx) => {
        const prev = currentOffsets[idx];
        return !prev || Math.abs(o.dx - prev.dx) > 0.05 || Math.abs(o.dy - prev.dy) > 0.05;
      });

    if (!hasMeaningfulChange) return;
    onUpdateBoundaryOffsets(newOffsets);
  }, [buildingsCenter.lat, buildingsCenter.lng, gridAngle, onUpdateBoundaryOffsets, editBoundaryLines, effectiveBoundaryOffsets]);

  const handlePolygonLoad = useCallback((poly) => {
    polygonRef.current = poly;
  }, []);

  // Attach vertex listeners ONLY when editBoundaryLines is actively enabled by the user
  useEffect(() => {
    if (!editBoundaryLines || !polygonRef.current) return;
    const path = polygonRef.current.getPath();
    if (!path) return;

    const l1 = path.addListener("set_at", handlePolygonPathChange);
    const l2 = path.addListener("insert_at", handlePolygonPathChange);
    const l3 = path.addListener("remove_at", handlePolygonPathChange);

    return () => {
      if (window.google?.maps?.event) {
        window.google.maps.event.removeListener(l1);
        window.google.maps.event.removeListener(l2);
        window.google.maps.event.removeListener(l3);
      }
    };
  }, [editBoundaryLines, handlePolygonPathChange]);

  // Dragging the blue boundary polygon directly also moves the plots inside it
  const handlePolygonDragEnd = useCallback(() => {
    if (!polygonRef.current || !onUpdatePlots || boundaryPaths.length === 0) return;
    const path = polygonRef.current.getPath();
    if (!path || path.getLength() === 0) return;
    let newSumLat = 0;
    let newSumLng = 0;
    const len = path.getLength();
    for (let i = 0; i < len; i++) {
      const pt = path.getAt(i);
      newSumLat += pt.lat();
      newSumLng += pt.lng();
    }
    const newCLat = newSumLat / len;
    const newCLng = newSumLng / len;

    let oldSumLat = 0;
    let oldSumLng = 0;
    for (const pt of boundaryPaths) {
      oldSumLat += pt.lat;
      oldSumLng += pt.lng;
    }
    const oldCLat = oldSumLat / boundaryPaths.length;
    const oldCLng = oldSumLng / boundaryPaths.length;

    const dLat = newCLat - oldCLat;
    const dLng = newCLng - oldCLng;
    if (Math.abs(dLat) > 1e-7 || Math.abs(dLng) > 1e-7) {
      const updated = translatePlots(plots, dLat, dLng, scopeFilter);
      onUpdatePlots(updated);
    }
  }, [boundaryPaths, plots, scopeFilter, onUpdatePlots]);

  // Filter pinned plots according to the selected legend status
  const visiblePlots = useMemo(() => {
    return plots.filter((p) => {
      if (p._deleted) return false;
      if (!p.gpsLat || !p.gpsLng) return false;
      return matchesStatusFilter(mapPlotStatus(p), effectiveFilter);
    });
  }, [plots, effectiveFilter]);

  // Plots that do not belong to an apartment row building (standalone plots)
  const standalonePlots = useMemo(() => {
    return visiblePlots.filter((p) => !getBuildingKey(p));
  }, [visiblePlots]);

  if (mapsAuthFailed) {
    return <MapUnavailable />;
  }

  if (loadError && !isGoogleAlreadyLoaded) {
    return (
      <div className="alert alert-danger" role="alert" style={{ margin: "1rem" }}>
        The map could not be loaded. Verify the Google Maps API key configuration.
      </div>
    );
  }

  if (!isLoaded) {
    return <MapLoading />;
  }


  return (
    <div style={WRAPPER_STYLE}>
      {/* ─── Top-Left: 2D/3D switch ─── */}
      <div className="map-mode-slot" style={{ position: "absolute", top: 12, left: 12, zIndex: 20 }}>
      {typeof onMapModeChange === "function" && <MapModeSwitch mode="2d" onChange={onMapModeChange} />}
      </div>

      {/* ─── Top-Right: base map (Map / Satellite + layers) ─── */}
      <div className="map-type-slot">
        <MapTypeControl mapTypeId={mapTypeId} onChange={setMapTypeId} />
      </div>

      {/* ─── Status key (top left, under the 2D/3D switch; same component as the 3D map) ─── */}
      {showLegend && (
        <MapStatusKey
          filter={effectiveFilter}
          onFilter={(next) => {
            setActiveFilter(next);
            if (typeof onStatusFilterChange === "function") onStatusFilterChange(next);
          }}
          belowSwitch={typeof onMapModeChange === "function"}
          collapsible={isPhone}
          open={!isPhone || legendOpen}
          onToggle={() => setLegendOpen((open) => !open)}
        />
      )}

      {/* Block types (the directory's legend): one line at the bottom left,
          above Google's logo; scrolls sideways if too long. */}
      {showLegend && !isPhone && (
        <div
          className="map-types-strip"
          style={{ left: 12, bottom: 30, maxWidth: "calc(100% - 90px)" }}
        >
          <BlockTypeLegend inline wrap={false} />
        </div>
      )}

      {/* ─── Google Map Instance ─── */}
      <GoogleMap
        mapContainerStyle={CONTAINER_STYLE}
        center={center}
        mapTypeId={mapTypeId}
        options={options}
        onLoad={onLoad}
        onUnmount={onUnmount}
        onClick={handleMapClick}
      >
        {/* The rest of the park, under the rows: blocks not mapped yet (grey
            roofs, not tappable) and the buildings, with their names. */}
        {site.blocks.map((b) => (
          <PolygonF
            key={`site-block-${b.name}`}
            paths={b.path}
            options={{
              strokeColor: "#ffffff",
              strokeOpacity: 0.9,
              strokeWeight: 1.5,
              fillColor: "#94a3b8",
              fillOpacity: 0.55,
              clickable: false,
              zIndex: 60,
            }}
          />
        ))}
        {site.buildings.map((b, i) => (
          <PolygonF
            key={`site-building-${i}`}
            paths={b.path}
            options={{
              strokeColor: "#facc15",
              strokeOpacity: 0.9,
              strokeWeight: 1.5,
              fillColor: "#facc15",
              fillOpacity: 0.08,
              clickable: false,
              zIndex: 55,
            }}
          />
        ))}
        {mapsReady &&
          zoomLevel >= 16.5 &&
          [...site.blocks.map((b) => ({ ...b, kind: "block" })), ...site.buildings.map((b) => ({ ...b, kind: "building" }))].map(
            (b, i) => (
              <MarkerF
                key={`site-label-${i}`}
                position={b.center}
                clickable={false}
                icon={getSiteLabelIcon(b.name, b.angleDeg, b.kind)}
                zIndex={b.kind === "block" ? 320 : 310}
              />
            )
          )}

        {/* Navigation Polyline */}
        {routeSegments.road.length > 1 && (
          <PolylineF
            path={routeSegments.road}
            options={{ strokeColor: "#00E5FF", strokeWeight: 5, strokeOpacity: 0.9, zIndex: 300 }}
          />
        )}
        {/* "You're here": a walking person at the visitor's live position, else at the route start */}
        {(userPosition || routePath.length > 1) && mapsReady && (
          <MarkerF
            position={userPosition ? { lat: userPosition.lat, lng: userPosition.lng } : routePath[0]}
            title="You're here"
            zIndex={540}
            icon={{
              url: WALKER_PIN_ICON,
              anchor: new window.google.maps.Point(20, 48),
              scaledSize: new window.google.maps.Size(40, 50),
            }}
          />
        )}
        {userPosition && Number.isFinite(userPosition.accuracy) && (
          <CircleF
            center={{ lat: userPosition.lat, lng: userPosition.lng }}
            radius={userPosition.accuracy}
            options={{
              strokeColor: "#2563eb",
              strokeOpacity: 0.5,
              strokeWeight: 1,
              fillColor: "#2563eb",
              fillOpacity: 0.12,
              clickable: false,
              zIndex: 310,
            }}
          />
        )}
        {routeSegments.connectors.map((segment, index) => (
          <PolylineF
            key={`route-connector-${index}`}
            path={segment}
            options={{
              strokeOpacity: 0,
              zIndex: 300,
              icons: [
                {
                  icon: { path: "M 0,-1 0,1", strokeColor: "#00E5FF", strokeOpacity: 1, strokeWeight: 4, scale: 3 },
                  offset: "0",
                  repeat: "14px",
                },
              ],
            }}
          />
        ))}

        {/* Cemetery Section Boundary Polygon (Blue outline — customizable length/size by lines) */}
        {boundaryPaths.length >= 3 && (
        <PolygonF
          paths={boundaryPaths}
          editable={editBoundaryLines}
          draggable={adjustMode && !editBoundaryLines}
          onLoad={handlePolygonLoad}
          onDragEnd={handlePolygonDragEnd}
          options={{
            strokeColor: editBoundaryLines ? "#00E5FF" : "#00A3FF",
            strokeOpacity: 0.9,
            strokeWeight: editBoundaryLines ? 3.5 : 2.5,
            fillColor: "#00A3FF",
            fillOpacity: editBoundaryLines ? 0.08 : 0.04,
            clickable: adjustMode,
            draggable: adjustMode && !editBoundaryLines,
            editable: editBoundaryLines,
            cursor: editBoundaryLines ? "crosshair" : adjustMode ? "move" : "default",
            zIndex: 10,
          }}
        />
        )}

        {/* ─── Adjust / Crop Tool: Center Move Anchor & Rotation Handle ─── */}
        {adjustMode && !buildingActive && adjustBbox && (
          <>
            {/* Top stem line connecting bounding box to rotation handle */}
            <PolylineF
              path={[
                { lat: adjustBbox.maxLat, lng: adjustBbox.centerLng },
                { lat: adjustBbox.maxLat + 2.0 * M_TO_LAT, lng: adjustBbox.centerLng },
              ]}
              options={{
                strokeColor: "#A855F7",
                strokeOpacity: 0.85,
                strokeWeight: 2,
                zIndex: 490,
              }}
            />

            {/* Joint node on top boundary edge */}
            <MarkerF
              position={{
                lat: adjustBbox.maxLat,
                lng: adjustBbox.centerLng,
              }}
              icon={{
                path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
                scale: 3.5,
                fillColor: "#A855F7",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 1.5,
              }}
              zIndex={495}
            />

            {/* Central Move Anchor Marker */}
            {anchorPos && (
              <MarkerF
                position={anchorPos}
                draggable
                icon={getMoveAnchorIcon()}
                title="Drag this anchor to slide the plot grid across the map"
                onDrag={handleAnchorDrag}
                onDragEnd={handleAnchorDragEnd}
                zIndex={500}
              />
            )}

            {/* Top Rotation Handle Marker */}
            <MarkerF
              position={{
                lat: adjustBbox.maxLat + 2.0 * M_TO_LAT,
                lng: adjustBbox.centerLng,
              }}
              draggable
              icon={getRotateHandleIcon()}
              title="Drag horizontally to rotate plots around the center"
              onDrag={handleRotateDrag}
              zIndex={500}
            />
          </>
        )}

        {/* ─── Building blocks (one per row / building) ─── */}
        {allBuildingBlocks.map((block) => {
          const isTargetActive = block.isTargetActive;
          return (
            <Fragment key={`building-block-${block.rowKey}`}>
              {/* Outer Building Block Boundary (Dark Slate Outline / Cyan Accent when active) */}
              <PolygonF
                paths={block.corners}
                options={{
                  fillColor: "#0f172a",
                  fillOpacity: isTargetActive ? 0.16 : 0.08,
                  strokeColor: isTargetActive ? "#00E5FF" : "#0f172a",
                  strokeWeight: isTargetActive ? 4 : 3,
                  strokeOpacity: 0.95,
                  zIndex: isTargetActive ? 345 : 340,
                  cursor: adjustMode ? "pointer" : "default",
                }}
                onClick={() => {
                  if (adjustMode && buildingToolOpen && onUpdateBuildingConfig && !isTargetActive && block.plots.length > 0) {
                    const snapped = snapBuildingToPlots(block.plots, gridAngle ?? DEFAULT_GRID_ANGLE_DEG);
                    if (snapped) {
                      onUpdateBuildingConfig((prev) => ({
                        ...prev,
                        ...snapped,
                        targetRow: block.rowKey,
                        active: true,
                      }));
                    }
                  }
                }}
              />

              {/* Subdivided Plot Cells with Crisp White Dividers & Status Colors */}
              {block.cells.map((cell) => {
                const isDimmed = dimmed.has(cell.plot?.id);
                // "partial" when a multi-tier column still has vacant tiers.
                const cellStatus = mapPlotStatus(cell.plot ?? { status: cell.status });
                const color = isDimmed ? "#64748b" : getPlotStatusColor(cellStatus);
                const isSelected = selectedPlot?.id === cell.plot?.id;
                const isHovered = hoveredPlot?.id === cell.plot?.id;
                const matchesFilter = matchesStatusFilter(cellStatus, effectiveFilter);
                // A multi-tier column is drawn as one strip per tier: red occupied, green vacant.
                const occ =
                  cell.plot && Array.isArray(cell.plot.graves) && cell.status !== "reserved" && cell.status !== "maintenance"
                    ? tierOccupancy(cell.plot)
                    : null;
                const tierStrips =
                  occ && occ.total > 1 && !isDimmed && !isSelected ? splitCellAcross(cell.corners, occ.total) : null;
                const cellOpacity = isSelected
                  ? 0.95
                  : isDimmed
                  ? 0.3
                  : isHovered
                  ? 0.9
                  : matchesFilter
                  ? 0.85
                  : 0.2;

                return (
                  <Fragment key={`b-cell-${block.rowKey}-${cell.index}`}>
                    {tierStrips?.map((path, k) => (
                      <PolygonF
                        key={`tier-${k}`}
                        paths={path}
                        options={{
                          fillColor: getPlotStatusColor(occ.tiers[k] ? "occupied" : "available"),
                          fillOpacity: cellOpacity,
                          strokeColor: "#ffffff",
                          strokeWeight: 0.6,
                          strokeOpacity: 0.8,
                          clickable: false,
                          zIndex: 349,
                        }}
                      />
                    ))}
                    {/* The cell outline takes the clicks; its fill is left to the tier strips when there are some. */}
                    <PolygonF
                      paths={cell.corners}
                      options={{
                        fillColor: color,
                        fillOpacity: tierStrips ? 0 : cellOpacity,
                        strokeColor: isSelected
                          ? "#00E5FF"
                          : cell.plot?._modified
                          ? "#F59E0B"
                          : "#ffffff",
                        strokeWeight: isSelected ? 2.5 : cell.plot?._modified ? 2 : 1.5,
                        strokeOpacity: 1,
                        zIndex: isSelected ? 365 : isHovered ? 360 : 350,
                        cursor: isDimmed ? "not-allowed" : "pointer",
                      }}
                      onClick={() => {
                        if (
                          adjustMode &&
                          buildingActive &&
                          onUpdateBuildingConfig &&
                          !isTargetActive &&
                          block.plots.length > 0
                        ) {
                          const snapped = snapBuildingToPlots(block.plots, gridAngle ?? DEFAULT_GRID_ANGLE_DEG);
                          if (snapped) {
                            onUpdateBuildingConfig((prev) => ({
                              ...prev,
                              ...snapped,
                              targetRow: block.rowKey,
                              active: true,
                            }));
                          }
                          return;
                        }
                        if (cell.plot && typeof onSelectPlot === "function") {
                          onSelectPlot(cell.plot);
                        }
                      }}
                      onMouseOver={() => {
                        if (cell.plot) setHoveredPlot(cell.plot);
                      }}
                      onMouseOut={() => setHoveredPlot(null)}
                    />

                    {/* Rotated Cell Number Marker */}
                    {zoomLevel >= 18.5 && (
                      <MarkerF
                        position={cell.center}
                        clickable={false}
                        icon={
                          mapsReady
                            ? {
                                url: createPlotLabelIcon({
                                  plotNumber: columnShortLabel(cell.label),
                                  deceasedNames: cell.plot ? getPlotOccupantNames(cell.plot) : [],
                                  angleDeg: block.cfg.angleDeg,
                                  showName: false,
                                }).url,
                                anchor: new window.google.maps.Point(24, 12),
                                scaledSize: new window.google.maps.Size(48, 24),
                              }
                            : undefined
                        }
                        zIndex={370}
                      />
                    )}

                    {/* Blue Map Pin planted on Selected Plot */}
                    {isSelected && !adjustMode && (
                      <MarkerF
                        position={cell.center}
                        clickable={false}
                        icon={
                          mapsReady
                            ? {
                                url: BLUE_PIN_ICON,
                                anchor: new window.google.maps.Point(14, 36),
                                scaledSize: new window.google.maps.Size(28, 36),
                              }
                            : undefined
                        }
                        zIndex={530}
                      />
                    )}

                    {/* Pinpoint Drag Handle: ONLY in Plot Coordinates adjust tab (NOT when buildingConfig is active) */}
                    {adjustMode && !buildingActive && cell.plot && scopeFilter(cell.plot) && (
                      <MarkerF
                        position={cell.center}
                        draggable
                        icon={{
                          path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
                          fillColor: cell.plot._modified
                            ? "#F59E0B"
                            : isSelected
                            ? "#00E5FF"
                            : "#ffffff",
                          fillOpacity: 0.95,
                          strokeColor: "#0f172a",
                          strokeWeight: 1.5,
                          scale: 5,
                        }}
                        title={`Drag to pinpoint ${cell.label}`}
                        onDragEnd={(e) => {
                          if (e.latLng && typeof onSinglePlotDrag === "function") {
                            onSinglePlotDrag(cell.plot, e.latLng.lat(), e.latLng.lng());
                          }
                        }}
                        zIndex={isSelected ? 400 : 300}
                      />
                    )}
                  </Fragment>
                );
              })}

              {/* Building Row Title Badge at intermediate zoom levels */}
              {zoomLevel >= 16.5 && zoomLevel < 18.5 && (
                <MarkerF
                  position={{ lat: block.cfg.centerLat, lng: block.cfg.centerLng }}
                  clickable={false}
                  icon={getBlockTitleBadgeIcon(block.rowKey, block.cfg.angleDeg)}
                  zIndex={330}
                />
              )}
            </Fragment>
          );
        })}

        {/* ─── Interactive Handles for Currently Active Building Block ─── */}
        {buildingActive && (
          <>
            {/* Rotate Stem Line & Joint (North Edge) */}
            {buildingTopEdgePos && buildingRotateHandlePos && (
              <>
                <PolylineF
                  path={[buildingTopEdgePos, buildingRotateHandlePos]}
                  options={{
                    strokeColor: "#F59E0B",
                    strokeWeight: 2,
                    strokeOpacity: 0.85,
                    zIndex: 480,
                  }}
                />
                <MarkerF
                  position={buildingTopEdgePos}
                  clickable={false}
                  icon={{
                    path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
                    scale: 3,
                    fillColor: "#F59E0B",
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 1.5,
                  }}
                  zIndex={485}
                />
              </>
            )}

            {/* Width Stem Line & Joint (South Edge) */}
            {buildingBottomEdgePos && buildingWidthHandlePos && (
              <>
                <PolylineF
                  path={[buildingBottomEdgePos, buildingWidthHandlePos]}
                  options={{
                    strokeColor: "#A855F7",
                    strokeWeight: 2,
                    strokeOpacity: 0.85,
                    zIndex: 480,
                  }}
                />
                <MarkerF
                  position={buildingBottomEdgePos}
                  clickable={false}
                  icon={{
                    path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
                    scale: 3,
                    fillColor: "#A855F7",
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 1.5,
                  }}
                  zIndex={485}
                />
              </>
            )}

            {/* Length Stem Line & Joint (East Edge) */}
            {buildingRightEdgePos && buildingLengthHandlePos && (
              <>
                <PolylineF
                  path={[buildingRightEdgePos, buildingLengthHandlePos]}
                  options={{
                    strokeColor: "#10B981",
                    strokeWeight: 2,
                    strokeOpacity: 0.85,
                    zIndex: 480,
                  }}
                />
                <MarkerF
                  position={buildingRightEdgePos}
                  clickable={false}
                  icon={{
                    path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
                    scale: 3,
                    fillColor: "#10B981",
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 1.5,
                  }}
                  zIndex={485}
                />
              </>
            )}

            {/* Apply & Save Stem Line & Joint (West Edge) */}
            {buildingLeftEdgePos && buildingApplyHandlePos && (
              <>
                <PolylineF
                  path={[buildingLeftEdgePos, buildingApplyHandlePos]}
                  options={{
                    strokeColor: "#10B981",
                    strokeWeight: 2,
                    strokeOpacity: 0.85,
                    zIndex: 480,
                  }}
                />
                <MarkerF
                  position={buildingLeftEdgePos}
                  clickable={false}
                  icon={{
                    path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
                    scale: 3,
                    fillColor: "#10B981",
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 1.5,
                  }}
                  zIndex={485}
                />
              </>
            )}

            {/* Apply & Save Button (West Edge) */}
            {buildingApplyHandlePos && (
              <MarkerF
                position={buildingApplyHandlePos}
                clickable
                icon={getBuildingApplyHandleIcon()}
                title="Click to apply rotated coordinates to plots and save to database"
                onClick={() => {
                  if (typeof onApplyBuildingConfig === "function") {
                    onApplyBuildingConfig();
                  }
                }}
                zIndex={540}
              />
            )}

            {/* Center Move Anchor */}
            <MarkerF
              position={{ lat: buildingConfig.centerLat, lng: buildingConfig.centerLng }}
              draggable
              icon={getBuildingMoveAnchorIcon()}
              title="Drag this anchor to position the building over the satellite roof"
              onDrag={handleBuildingAnchorDrag}
              onDragEnd={handleBuildingAnchorDrag}
              zIndex={530}
            />

            {/* Rotation Handle (North) */}
            {buildingRotateHandlePos && (
              <MarkerF
                position={buildingRotateHandlePos}
                draggable
                icon={getBuildingRotateHandleIcon(buildingConfig.angleDeg)}
                title="Drag to rotate building alignment to match the roof line"
                onDrag={handleBuildingRotateDrag}
                onDragEnd={handleBuildingRotateDrag}
                zIndex={520}
              />
            )}

            {/* Length Resize Handle (East) */}
            {buildingLengthHandlePos && (
              <MarkerF
                position={buildingLengthHandlePos}
                draggable
                icon={getBuildingLengthHandleIcon(buildingConfig.lengthMeters)}
                title="Drag horizontally to adjust building length"
                onDrag={handleBuildingLengthDrag}
                onDragEnd={handleBuildingLengthDrag}
                zIndex={510}
              />
            )}

            {/* Width Resize Handle (South) */}
            {buildingWidthHandlePos && (
              <MarkerF
                position={buildingWidthHandlePos}
                draggable
                icon={getBuildingWidthHandleIcon(buildingConfig.widthMeters)}
                title="Drag vertically to adjust building width / depth"
                onDrag={handleBuildingWidthDrag}
                onDragEnd={handleBuildingWidthDrag}
                zIndex={510}
              />
            )}
          </>
        )}

        {/* ─── Standalone Plots (Sections A, B, C, Lawn Plots) ─── */}
        {standalonePlots.map((plot) => {
          if (!plot.gpsLat || !plot.gpsLng) return null;
          const pos = { lat: Number(plot.gpsLat), lng: Number(plot.gpsLng) };
          const isDimmed = dimmed.has(plot.id);
          const color = isDimmed ? "#64748b" : getPlotStatusColor(plot.status);
          const isSelected = selectedPlot?.id === plot.id;
          const isHovered = hoveredPlot?.id === plot.id;

          // In editable mode, render draggable markers for standalone plots
          if (editable) {
            return (
              <MarkerF
                key={plot.id}
                position={pos}
                draggable
                icon={circleSymbol(color, false)}
                onDragEnd={(e) => {
                  if (typeof onPlotDragEnd === "function" && e.latLng) {
                    onPlotDragEnd(plot, e.latLng.lat(), e.latLng.lng());
                  }
                }}
              />
            );
          }

          // Calculate rectangular footprint for standalone plots
          const corners = getPlotCorners({
            lat: pos.lat,
            lng: pos.lng,
            widthMeters: 2.65,
            depthMeters: 1.6,
            angleDeg: 0,
          });

          return (
            <Fragment key={`plot-frag-${plot.id}`}>
              <PolygonF
                key={`poly-${plot.id}`}
                paths={corners}
                options={{
                  fillColor: color,
                  fillOpacity: isSelected ? 0.95 : isDimmed ? 0.3 : isHovered ? 0.9 : 0.85,
                  strokeColor: plot._modified
                    ? "#F59E0B"
                    : isSelected
                    ? "#00E5FF"
                    : "rgba(17, 24, 39, 0.65)",
                  strokeWeight: plot._modified ? 3 : isSelected ? 3.5 : 1,
                  strokeOpacity: 1,
                  zIndex: isSelected ? 200 : isHovered ? 150 : 20,
                  cursor: isDimmed ? "not-allowed" : "pointer",
                }}
                onClick={() => {
                  if (typeof onSelectPlot === "function") {
                    onSelectPlot(plot);
                  }
                }}
                onMouseOver={() => setHoveredPlot(plot)}
                onMouseOut={() => setHoveredPlot(null)}
              />

              {/* Blue Map Pin planted on Selected Standalone Plot */}
              {isSelected && !adjustMode && (
                <MarkerF
                  key={`selected-pin-${plot.id}`}
                  position={pos}
                  clickable={false}
                  icon={
                    mapsReady
                      ? {
                          url: BLUE_PIN_ICON,
                          anchor: new window.google.maps.Point(14, 36),
                          scaledSize: new window.google.maps.Size(28, 36),
                        }
                      : undefined
                  }
                  zIndex={500}
                />
              )}

              {/* Pinpoint Drag Handle for standalone plot in adjustMode */}
              {adjustMode && !buildingActive && scopeFilter(plot) && (
                <MarkerF
                  position={pos}
                  draggable
                  icon={{
                    path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
                    fillColor: plot._modified ? "#F59E0B" : isSelected ? "#00E5FF" : "#ffffff",
                    fillOpacity: 0.95,
                    strokeColor: "#0f172a",
                    strokeWeight: 1.5,
                    scale: 5,
                  }}
                  title={`Drag to pinpoint ${plot.plotNumber}`}
                  onDragEnd={(e) => {
                    if (e.latLng && typeof onSinglePlotDrag === "function") {
                      onSinglePlotDrag(plot, e.latLng.lat(), e.latLng.lng());
                    }
                  }}
                  zIndex={isSelected ? 400 : 300}
                />
              )}
            </Fragment>
          );
        })}

        {/* Selected Plot Callout Bubble on Map */}
        {selectedPlot?.gpsLat && selectedPlot?.gpsLng && !adjustMode && (() => {
          const calloutNames = getPlotSummaryNames(selectedPlot);
          return (
            <InfoWindowF
              position={{ lat: Number(selectedPlot.gpsLat), lng: Number(selectedPlot.gpsLng) }}
              options={{
                disableAutoPan: true,
                headerDisabled: true,
                pixelOffset: mapsReady ? new window.google.maps.Size(0, -36) : undefined,
              }}
              onCloseClick={() => {
                if (typeof onSelectPlot === "function") {
                  onSelectPlot(null);
                }
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "2px 2px",
                  fontFamily: "var(--font-sans)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    fontSize: "0.85rem",
                    fontWeight: 700,
                    color: "#111827",
                    whiteSpace: "nowrap",
                    lineHeight: 1.25,
                  }}
                >
                  {calloutNames.map((name, idx) => (
                    <span key={idx}>{name}</span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof onSelectPlot === "function") {
                      onSelectPlot(null);
                    }
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: "0 2px",
                    margin: 0,
                    cursor: "pointer",
                    color: "#6b7280",
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    lineHeight: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    alignSelf: "center",
                    transition: "color 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#111827")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#6b7280")}
                  aria-label="Close callout"
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </InfoWindowF>
          );
        })()}

        {/* Draggable draft marker for placing / adding new plot */}
        {draftMarker && Number.isFinite(draftMarker.lat) && Number.isFinite(draftMarker.lng) && (
          <MarkerF
            position={{ lat: draftMarker.lat, lng: draftMarker.lng }}
            draggable
            icon={draftSymbol()}
            onDragEnd={(e) => {
              if (typeof onMapClick === "function" && e.latLng) {
                onMapClick(e.latLng.lat(), e.latLng.lng());
              }
            }}
          />
        )}
      </GoogleMap>
    </div>
  );
}

export default function CemeteryMap(props) {
  const apiKey = getClientGoogleMapsApiKey();

  if (!apiKey) {
    return (
      <div
        style={{
          ...WRAPPER_STYLE,
          minHeight: 480,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-card, #0f172a)",
          color: "var(--text-main, #f8fafc)",
          padding: "2rem",
          textAlign: "center",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div
          style={{
            width: 54,
            height: 54,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "1rem",
            color: "var(--danger, #ef4444)",
          }}
        >
          <AlertTriangle size={26} />
        </div>
        <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.15rem", fontWeight: 600 }}>
          Google Maps API Key Missing
        </h3>
        <p
          style={{
            margin: "0 0 1rem 0",
            color: "var(--text-muted, #94a3b8)",
            maxWidth: 420,
            fontSize: "0.875rem",
            lineHeight: 1.5,
          }}
        >
          The interactive cemetery map requires a valid Google Maps API key.
        </p>
        {typeof props.onMapModeChange === "function" && (
          <button type="button" className="btn btn-primary" onClick={() => props.onMapModeChange("3d")}>
            Use the 3D map instead
          </button>
        )}
      </div>
    );
  }

  return <GoogleMapLoadedView {...props} apiKey={apiKey} />;
}
