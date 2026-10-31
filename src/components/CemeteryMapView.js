"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import MapLoading from "@/components/map/MapLoading";

/**
 * The cemetery map with a 2D / 3D switch: 2D is the Google satellite map
 * (CemeteryMap), 3D is the drawn park view (CemeteryMap3D). Each viewer's
 * choice is remembered in this browser. The Admin's layout tools only exist
 * on the 2D map, so `layoutTools` forces 2D while they are open.
 *
 * Takes every CemeteryMap / CemeteryMap3D prop and passes it through.
 */

const Loading = MapLoading;
const CemeteryMap = dynamic(() => import("@/components/CemeteryMap"), { ssr: false, loading: Loading });
const CemeteryMap3D = dynamic(() => import("@/components/map3d/CemeteryMap3D"), { ssr: false, loading: Loading });

const STORAGE_KEY = "smart-cemetery:map-mode";
export const DEFAULT_MAP_MODE = "2d";

function readMode() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "2d" || saved === "3d" ? saved : DEFAULT_MAP_MODE;
  } catch {
    return DEFAULT_MAP_MODE;
  }
}

export default function CemeteryMapView({ layoutTools = false, ...props }) {
  const [mode, setMode] = useState(readMode);

  const choose = (next) => {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private windows may block storage; the choice still applies for this visit.
    }
  };

  if (mode === "3d" && !layoutTools) {
    return <CemeteryMap3D {...props} mapMode="3d" onMapModeChange={choose} />;
  }
  return <CemeteryMap {...props} mapMode="2d" onMapModeChange={layoutTools ? undefined : choose} />;
}
