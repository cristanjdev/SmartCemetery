/**
 * Google Maps marker/symbol factories for the cemetery map. These read
 * `window.google.maps` at call time, so they must only run in the browser
 * after the Maps API has loaded.
 */

// Building Block Generator Handle Icons
import { DEFAULT_BUILDING_LENGTH_M, DEFAULT_BUILDING_WIDTH_M, DEFAULT_GRID_ANGLE_DEG } from "@/lib/config";
import { buildingLabel } from "@/lib/cemetery-layout";

export function getBuildingMoveAnchorIcon() {
  if (typeof window === "undefined" || typeof window.google?.maps?.Size !== "function") return undefined;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="104" height="26" viewBox="0 0 104 26">
    <defs>
      <filter id="b-mv-sh" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.6"/>
      </filter>
    </defs>
    <rect x="2" y="2" width="100" height="22" rx="11" fill="#0f172a" stroke="#00E5FF" stroke-width="1.8" filter="url(#b-mv-sh)"/>
    <g transform="translate(14, 13)" stroke="#00E5FF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M-4 0 L4 0 M0 -4 L0 4"/>
      <path d="M-2 -1.5 L-4 0 L-2 1.5"/>
      <path d="M2 -1.5 L4 0 L2 1.5"/>
      <path d="M-1.5 -2 L0 -4 L1.5 -2"/>
      <path d="M-1.5 2 L0 4 L1.5 2"/>
    </g>
    <text x="27" y="16.5" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="700" letter-spacing="0.4">MOVE BLOCK</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(104, 26),
    anchor: new window.google.maps.Point(52, 13),
  };
}

export function getBuildingLengthHandleIcon(lengthMeters = DEFAULT_BUILDING_LENGTH_M) {
  if (typeof window === "undefined" || typeof window.google?.maps?.Size !== "function") return undefined;
  const text = `${Number(lengthMeters).toFixed(1)}m`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="86" height="26" viewBox="0 0 86 26">
    <defs>
      <filter id="b-len-sh" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.55"/>
      </filter>
    </defs>
    <rect x="2" y="2" width="82" height="22" rx="11" fill="#064e3b" stroke="#10b981" stroke-width="1.8" filter="url(#b-len-sh)"/>
    <g transform="translate(14, 13)" stroke="#34d399" stroke-width="1.6" stroke-linecap="round" fill="none">
      <path d="M-4.5 0 L4.5 0"/>
      <path d="M-2.5 -2 L-4.5 0 L-2.5 2"/>
      <path d="M2.5 -2 L4.5 0 L2.5 2"/>
    </g>
    <text x="26" y="16.5" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="700">${text}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(86, 26),
    anchor: new window.google.maps.Point(43, 13),
  };
}

export function getBuildingWidthHandleIcon(widthMeters = DEFAULT_BUILDING_WIDTH_M) {
  if (typeof window === "undefined" || typeof window.google?.maps?.Size !== "function") return undefined;
  const text = `${Number(widthMeters).toFixed(1)}m`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="82" height="26" viewBox="0 0 82 26">
    <defs>
      <filter id="b-wid-sh" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.55"/>
      </filter>
    </defs>
    <rect x="2" y="2" width="78" height="22" rx="11" fill="#3b0764" stroke="#a855f7" stroke-width="1.8" filter="url(#b-wid-sh)"/>
    <g transform="translate(13, 13)" stroke="#c084fc" stroke-width="1.6" stroke-linecap="round" fill="none">
      <path d="M0 -4.5 L0 4.5"/>
      <path d="M-2 -2.5 L0 -4.5 L2 -2.5"/>
      <path d="M-2 2.5 L0 4.5 L2 2.5"/>
    </g>
    <text x="25" y="16.5" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="700">${text}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(82, 26),
    anchor: new window.google.maps.Point(41, 13),
  };
}

export function getBuildingRotateHandleIcon(angleDeg = DEFAULT_GRID_ANGLE_DEG) {
  if (typeof window === "undefined" || typeof window.google?.maps?.Size !== "function") return undefined;
  const text = `${Number(angleDeg).toFixed(1)}°`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="26" viewBox="0 0 84 26">
    <defs>
      <filter id="b-rot-sh" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.55"/>
      </filter>
    </defs>
    <rect x="2" y="2" width="80" height="22" rx="11" fill="#78350f" stroke="#f59e0b" stroke-width="1.8" filter="url(#b-rot-sh)"/>
    <g transform="translate(13, 13)">
      <path d="M-3 -1.5 A 4 4 0 1 1 -3 2.5" fill="none" stroke="#fbbf24" stroke-width="1.6" stroke-linecap="round"/>
      <polygon points="-4.5,-2 -0.5,-1.5 -2,-5" fill="#fbbf24"/>
    </g>
    <text x="25" y="16.5" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="700">${text}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(84, 26),
    anchor: new window.google.maps.Point(42, 13),
  };
}

export function getBuildingApplyHandleIcon() {
  if (typeof window === "undefined" || typeof window.google?.maps?.Size !== "function") return undefined;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="26" viewBox="0 0 112 26">
    <defs>
      <filter id="b-app-sh" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.55"/>
      </filter>
    </defs>
    <rect x="2" y="2" width="108" height="22" rx="11" fill="#064e3b" stroke="#10b981" stroke-width="1.8" filter="url(#b-app-sh)"/>
    <g transform="translate(14, 13)" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M-4 0 L-1 3.5 L5 -3"/>
    </g>
    <text x="27" y="16.5" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9" font-weight="700" letter-spacing="0.3">APPLY &amp; SAVE</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(112, 26),
    anchor: new window.google.maps.Point(56, 13),
  };
}

export function getBlockTitleBadgeIcon(title, angleDeg = DEFAULT_GRID_ANGLE_DEG) {
  if (typeof window === "undefined" || typeof window.google?.maps?.Size !== "function") return undefined;
  const cleanTitle = buildingLabel(title);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="32" viewBox="0 0 120 32">
    <g transform="rotate(${-angleDeg}, 60, 16)">
      <rect x="4" y="4" width="112" height="24" rx="12" fill="rgba(15, 23, 42, 0.88)" stroke="#ffffff" stroke-width="1.5"/>
      <text x="60" y="20" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11.5" font-weight="700">${cleanTitle}</text>
    </g>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(120, 32),
    anchor: new window.google.maps.Point(60, 16),
  };
}

// Blue teardrop map pin for selected plot
export const BLUE_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <defs>
    <filter id="pinShadow" x="-20%" y="-10%" width="140%" height="130%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="rgba(0,0,0,0.35)"/>
    </filter>
  </defs>
  <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22c0-7.7-6.3-14-14-14z" fill="#0284c7" stroke="#ffffff" stroke-width="2" filter="url(#pinShadow)"/>
  <circle cx="14" cy="13" r="4.5" fill="#ffffff"/>
</svg>`;

export const BLUE_PIN_ICON = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(BLUE_PIN_SVG)}`;

/**
 * Generates an SVG data URL for in-plot text labels, rotated to match the
 * plot angle. Vacant cells show just the cell number; occupied cells show
 * numbered deceased names ("1. Jane Peters") like the reference plot map.
 * Returns { url, width, height } so the caller can anchor the icon precisely.
 */
export function createPlotLabelIcon({
  plotNumber,
  deceasedNames = [],
  angleDeg = DEFAULT_GRID_ANGLE_DEG,
  showName = false,
}) {
  let cellNumber = plotNumber;
  const colMatch = plotNumber?.match(/(?:-C0*|^Plot\s*|^0*)(\d+)$/i);
  if (colMatch) {
    cellNumber = colMatch[1];
  }

  const escapeXml = (str) =>
    (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const truncate = (str, max = 16) => {
    const s = (str || "").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  };

  // Marker SVGs are rendered as images, which cannot load web fonts, so use
  // the system sans-serif closest to the app's Inter typeface.
  const LABEL_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
  const names = showName
    ? deceasedNames.map((n) => truncate(n)).filter(Boolean).slice(0, 2)
    : [];

  const width = names.length > 0 ? 120 : 48;
  const lineHeight = 13;
  const lineCount = Math.max(1, names.length);
  const height = names.length > 0 ? lineCount * lineHeight + 8 : 24;
  const cx = width / 2;
  const cy = height / 2;

  let textSvg = "";
  if (names.length === 0) {
    // Vacant cell or number-only mode: clean centered cell number
    textSvg = `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="${LABEL_FONT}" font-size="11.5" font-weight="700" fill="#111827" stroke="#ffffff" stroke-width="2.4" paint-order="stroke fill">${escapeXml(cellNumber)}</text>`;
  } else {
    const firstY = cy - ((lineCount - 1) * lineHeight) / 2 + 4;
    textSvg += `<text x="${cx}" y="${firstY}" text-anchor="middle" font-family="${LABEL_FONT}" font-size="10.5" font-weight="700" fill="#111827" stroke="#ffffff" stroke-width="2.2" paint-order="stroke fill">${escapeXml(cellNumber)}. ${escapeXml(names[0])}</text>`;
    for (let i = 1; i < names.length; i++) {
      textSvg += `<text x="${cx}" y="${firstY + i * lineHeight}" text-anchor="middle" font-family="${LABEL_FONT}" font-size="10" font-weight="600" fill="#111827" stroke="#ffffff" stroke-width="2.2" paint-order="stroke fill">${escapeXml(names[i])}</text>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="rotate(${-angleDeg}, ${cx}, ${cy})">${textSvg}</g></svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    width,
    height,
  };
}

// Fallback circle marker for zoomed out view / edit mode
export function circleSymbol(color, selected) {
  return {
    path: window.google?.maps?.SymbolPath?.CIRCLE ?? 0,
    fillColor: color,
    fillOpacity: 0.95,
    strokeColor: selected ? "#00E5FF" : "#ffffff",
    strokeWeight: selected ? 3 : 1.5,
    scale: selected ? 8 : 6,
  };
}

export function draftSymbol() {
  return {
    path: window.google?.maps?.SymbolPath?.BACKWARD_CLOSED_ARROW ?? 3,
    fillColor: "#2D6CDF",
    fillOpacity: 1,
    strokeColor: "#111111",
    strokeWeight: 2,
    scale: 6,
  };
}

// Formal CAD-style Move Anchor badge for Adjust Mode
export function getMoveAnchorIcon() {
  if (typeof window === "undefined" || typeof window.google?.maps?.Size !== "function") return undefined;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="32" viewBox="0 0 96 32">
    <defs>
      <filter id="m-sh" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.6"/>
      </filter>
    </defs>
    <rect x="2" y="2" width="92" height="28" rx="14" fill="#0f172a" stroke="#00E5FF" stroke-width="2" filter="url(#m-sh)"/>
    <g transform="translate(18, 16)" stroke="#00E5FF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M-6 0 L6 0 M0 -6 L0 6"/>
      <path d="M-4 -2.5 L-6.5 0 L-4 2.5"/>
      <path d="M4 -2.5 L6.5 0 L4 2.5"/>
      <path d="M-2.5 -4 L0 -6.5 L2.5 -4"/>
      <path d="M-2.5 4 L0 6.5 L2.5 4"/>
    </g>
    <text x="35" y="20" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" letter-spacing="0.5">MOVE</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(96, 32),
    anchor: new window.google.maps.Point(48, 16),
  };
}

// Formal CAD-style Rotate Handle badge for Adjust Mode
export function getRotateHandleIcon() {
  if (typeof window === "undefined" || typeof window.google?.maps?.Size !== "function") return undefined;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="104" height="32" viewBox="0 0 104 32">
    <defs>
      <filter id="r-sh" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.6"/>
      </filter>
    </defs>
    <rect x="2" y="2" width="100" height="28" rx="14" fill="#0f172a" stroke="#A855F7" stroke-width="2" filter="url(#r-sh)"/>
    <g transform="translate(18, 16)">
      <path d="M-5 -2 A 6 6 0 1 1 -5 4" fill="none" stroke="#C084FC" stroke-width="2" stroke-linecap="round"/>
      <polygon points="-7,-4 -1,-2 -4,-8" fill="#C084FC"/>
    </g>
    <text x="35" y="20" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" letter-spacing="0.5">ROTATE</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(104, 32),
    anchor: new window.google.maps.Point(52, 16),
  };
}
