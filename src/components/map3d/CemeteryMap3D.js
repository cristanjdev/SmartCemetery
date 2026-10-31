"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { Plus, Minus, Maximize, Layers, RotateCcw, RotateCw } from "lucide-react";
import MapModeSwitch from "@/components/map/MapModeSwitch";
import MapLoading from "@/components/map/MapLoading";
import BlockTypeLegend from "@/components/map/BlockTypeLegend";
import MapStatusKey, { PLOT_STATUS_KEY } from "@/components/map/MapStatusKey";
import { buildSceneLayout, growFootprint, hull2d, toLocal } from "@/lib/scene-layout";
import { sceneWalk } from "@/lib/scene-route";
import { TRACED_ROW_KEYS, placeSurroundings, placeUnmappedBlocks, siteYard } from "@/lib/site-surroundings";
import { regularizeBlocks } from "@/lib/block-grid";
import { MAP_KEY_CODES, MAX_STEP_S, STILL, easeActions, hasMotion, keyActions, stepView } from "@/lib/map-keys";
import { LAYOUT_PRESET } from "@/lib/layout-preset";
import { getPlotStatusColor } from "@/lib/map-geometry";
import { mapPlotStatus, matchesStatusFilter, tierOccupancy } from "@/lib/plot-format";
import { DEFAULT_GRID_ANGLE_DEG, KIOSK_START_POINT } from "@/lib/config";

/**
 * Custom 3D cemetery map (no Google Maps): crypt rows are raised blocks on a
 * paved site ringed by trees, with row names on the roofs, a pin on the chosen
 * plot, a "You're here" tag and an animated dashed walking route — the look
 * of the printed park directory. Positions come from the same plot GPS the
 * rest of the system uses, converted to metres around the site centre.
 *
 * Props mirror CemeteryMap's viewing props so pages can swap one for the
 * other: plots, selectedPlot, onSelectPlot, routeCoords, focusPoint,
 * statusFilter, onStatusFilterChange, dimmedPlotIds, showLegend.
 */

const BLOCK_HEIGHT_M = 2.4;
const ROOF_Y = BLOCK_HEIGHT_M + 0.07;
const FOV = 40;
const TOP_POLAR = 0.05;
// About the angle of the client's aerial photo of the park.
const TILT_POLAR = 0.72;
// The printed directory is drawn from the commercial-building side (north),
// so the default camera looks south from there; roof labels face that way.
const HOME_AZIMUTH = Math.PI;

const COLORS = {
  sky: "#cfe3f1",
  grass: "#86a865",
  paving: "#d8d4cb",
  wall: "#e4e5e7",
  roof: "#a4abb5",
  selected: "#22d3ee",
  result: "#f59e0b",
  dimmed: "#64748b",
  pin: "#e11d48",
  route: "#ef4444",
};

const LEGEND = PLOT_STATUS_KEY;

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

const HELP_SECTIONS = [
  {
    title: "Mouse",
    rows: [
      ["Drag", "Move around"],
      ["Shift + drag", "Turn and tilt"],
      ["Right-drag", "Turn and tilt"],
      ["Scroll", "Zoom"],
      ["Double-click", "Fly to that spot"],
      ["Click a block", "Choose the plot"],
    ],
  },
  {
    title: "Keyboard (hold to keep going)",
    rows: [
      ["Arrows or W A S D", "Move around"],
      ["Shift + ← →  or  Q E", "Turn left / right"],
      ["Shift + ↑ ↓  or  R F", "Tilt to top view / to the side"],
      ["+  −", "Zoom in / out"],
      ["T", "Top view on / off"],
      ["H", "Whole cemetery"],
      ["N", "Face the directory view"],
      ["?", "Show / hide this list"],
    ],
  },
  {
    title: "Touch",
    rows: [
      ["One finger", "Move around"],
      ["Pinch", "Zoom"],
      ["Two fingers", "Turn and tilt"],
    ],
  },
];

// Devices without WebGL get the flat 2D map instead.
const FlatMap = dynamic(() => import("@/components/CemeteryMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Text drawn onto a canvas, for roof labels and floating tags. */
function makeTextTexture(text, { color = "#0f172a", stroke = "#ffffff", background = null, size = 64 } = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `800 ${size}px "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.font = font;
  const pad = size * 0.35;
  canvas.width = Math.ceil(ctx.measureText(text).width + pad * 2);
  canvas.height = Math.ceil(size * 1.5);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (background) {
    ctx.fillStyle = background;
    const r = canvas.height * 0.22;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, r);
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = "round";
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: canvas.width / canvas.height };
}

function useTextTexture(text, options) {
  const key = JSON.stringify([text, options]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tex = useMemo(() => makeTextTexture(text, options), [key]);
  useEffect(() => () => tex.texture.dispose(), [tex]);
  return tex;
}

/** Flat label lying on a roof, running along the row. */
// Scratch vector for the camera's view direction (labels only read it).
const viewDir = new THREE.Vector3();

/**
 * Text painted flat on a roof. It turns half a circle when the camera moves
 * round to the other side, so it always reads upright, never upside down.
 */
function RoofLabel({ text, position, rotationY, maxLength }) {
  const { texture, aspect } = useTextTexture(text);
  const height = Math.min(2.4, maxLength / aspect);
  const mesh = useRef();
  const flipped = useRef(false);
  const base = rotationY + HOME_AZIMUTH;
  useFrame(({ camera }) => {
    if (!mesh.current) return;
    camera.getWorldDirection(viewDir);
    // The text's "up" on the ground; upright when it points away from the viewer.
    const facing = -Math.sin(base) * viewDir.x - Math.cos(base) * viewDir.z;
    const len = Math.hypot(viewDir.x, viewDir.z) || 1;
    const d = facing / len;
    // A dead zone so a camera looking along the row does not make it flicker.
    if (!flipped.current && d < -0.2) flipped.current = true;
    else if (flipped.current && d > 0.2) flipped.current = false;
    mesh.current.rotation.y = base + (flipped.current ? Math.PI : 0);
  });
  return (
    <mesh ref={mesh} position={position} rotation={new THREE.Euler(-Math.PI / 2, base, 0, "YXZ")} renderOrder={2}>
      <planeGeometry args={[height * aspect, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/** Tag that always faces the camera (plot number, "You're here", landmarks). */
function Tag({ text, position, color = "#ffffff", background = "#0f172a", height = 1.6 }) {
  const { texture, aspect } = useTextTexture(text, { color, background, stroke: null, size: 56 });
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={5}>
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  );
}

function cellColor({ status, isSelected, isHovered, isDimmed, isResult, showStatus }) {
  if (isSelected) return COLORS.selected;
  if (isDimmed) return COLORS.dimmed;
  let base = showStatus ? getPlotStatusColor(status) : isResult ? COLORS.result : COLORS.roof;
  if (isHovered) base = new THREE.Color(base).lerp(new THREE.Color("#ffffff"), 0.35).getStyle();
  return base;
}

const TIER_PANEL_COLORS = {
  occupied: new THREE.Color("#E15B52"),
  vacant: new THREE.Color("#7CC47F"),
  muted: new THREE.Color("#a3a9b1"),
};

/**
 * One coloured panel per tier on both long walls of a block, stacked like the
 * real crypt niches (tier 1 at the bottom): red where a grave is recorded,
 * green where the tier is still vacant. One instanced mesh per block.
 */
function TierFaces({ panels }) {
  const mesh = useRef();
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    panels.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rotationY);
      matrix.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.w, p.h, p.d ?? 0.06));
      m.setMatrixAt(i, matrix);
      m.setColorAt(i, p.color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [panels]);
  if (panels.length === 0) return null;
  return (
    <instancedMesh key={panels.length} ref={mesh} args={[UNIT_BOX, undefined, panels.length]}>
      <meshStandardMaterial roughness={0.75} />
    </instancedMesh>
  );
}

function Block({ block, selectedKey, hoveredKey, setHovered, onSelect, showStatus, dimmed, filter, resultIds }) {
  const { center, length, width, rotationY } = block;

  // Map status per cell ("partial" for a column with vacant tiers) and its tier counts.
  // Only real plots carry graves; drawn preset cells keep their stored status.
  const cellInfo = useMemo(
    () =>
      block.cells.map((cell) => {
        const real = Boolean(cell.plot) && Array.isArray(cell.plot.graves);
        return {
          status: real ? mapPlotStatus(cell.plot) : String(cell.status || "available").toLowerCase(),
          occ: real ? tierOccupancy(cell.plot) : null,
        };
      }),
    [block.cells]
  );

  // Which cells are drawn tier by tier: multi-tier columns in the staff views
  // (not the selected or dimmed one, which keep a single highlight colour).
  const isSplit = (cell, i) => {
    const { status, occ } = cellInfo[i];
    if (!showStatus || !occ || occ.total < 2 || status === "reserved" || status === "maintenance") return false;
    const isSelected = selectedKey != null && (selectedKey === cell.plot?.id || selectedKey === cell.label);
    return !isSelected && !(cell.plot?.id != null && dimmed.has(cell.plot.id));
  };

  // One strip per tier on the roof (red occupied, green vacant) and the same
  // tiers stacked on both walls, tier 1 at the bottom.
  const tierPanels = useMemo(() => {
    if (!showStatus) return [];
    const nx = Math.sin(rotationY);
    const nz = Math.cos(rotationY);
    const panels = [];
    block.cells.forEach((cell, i) => {
      if (!isSplit(cell, i)) return;
      const { status, occ } = cellInfo[i];
      const matches = matchesStatusFilter(status, filter);
      const hovered = hoveredKey === (cell.plot?.id ?? cell.label);
      const band = BLOCK_HEIGHT_M / occ.total;
      // The plot's own share of the roof: the whole width, or its face's half on a back-to-back block.
      const roofW = (cell.width ?? width) - 0.16;
      const strip = roofW / occ.total;
      // How far the plot sits off the block's centre line, and which wall(s) show its tiers.
      const off = (cell.center.x - center.x) * nx + (cell.center.z - center.z) * nz;
      const walls = (block.faces ?? 1) > 1 ? [off >= 0 ? 1 : -1] : [1, -1];
      occ.tiers.forEach((occupied, k) => {
        let color = !matches ? TIER_PANEL_COLORS.muted : occupied ? TIER_PANEL_COLORS.occupied : TIER_PANEL_COLORS.vacant;
        if (hovered) color = color.clone().lerp(new THREE.Color("#ffffff"), 0.35);
        const across = -roofW / 2 + strip * (k + 0.5);
        panels.push({
          x: cell.center.x + nx * across,
          z: cell.center.z + nz * across,
          y: ROOF_Y - 0.06,
          w: cell.length - 0.12,
          h: 0.14,
          d: strip - 0.08,
          rotationY,
          color,
        });
        for (const side of walls) {
          panels.push({
            x: cell.center.x - nx * off + side * nx * (width / 2 + 0.03),
            z: cell.center.z - nz * off + side * nz * (width / 2 + 0.03),
            y: band * (k + 0.5),
            w: cell.length - 0.22,
            h: band - 0.12,
            rotationY,
            color,
          });
        }
      });
    });
    return panels;
    // isSplit reads only the listed values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.cells, block.faces, center.x, center.z, cellInfo, showStatus, filter, rotationY, width, hoveredKey, selectedKey, dimmed]);

  const describe = (cell) => {
    const occ = cellInfo[block.cells.indexOf(cell)]?.occ;
    return showStatus && occ && occ.total > 1 ? `${occ.occupied}/${occ.total} occupied` : null;
  };

  // Hover and tap work anywhere on the block (roof or walls): the plot is the
  // cell nearest the point, which keeps taps easy on a phone.
  const nearestCell = (point) => {
    let best = null;
    let bestD = Infinity;
    for (const cell of block.cells) {
      const d = (cell.center.x - point.x) ** 2 + (cell.center.z - point.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = cell;
      }
    }
    return best;
  };
  const handlers = {
    onPointerMove: (e) => {
      e.stopPropagation();
      const cell = nearestCell(e.point);
      if (cell && hoveredKey !== (cell.plot?.id ?? cell.label)) {
        setHovered({ key: cell.plot?.id ?? cell.label, label: cell.label, detail: describe(cell) });
      }
    },
    onPointerOut: () => setHovered(null),
    onClick: (e) => {
      // A drag that ends on a block is a pan, not a tap.
      if (e.delta > 6) return;
      e.stopPropagation();
      const cell = nearestCell(e.point);
      if (!cell || (cell.plot?.id != null && dimmed.has(cell.plot.id))) return;
      onSelect(cell.plot || { plotNumber: cell.label, status: cell.status, _preset: true });
    },
  };

  return (
    <group {...handlers}>
      <mesh
        geometry={UNIT_BOX}
        position={[center.x, BLOCK_HEIGHT_M / 2, center.z]}
        rotation={[0, rotationY, 0]}
        scale={[length, BLOCK_HEIGHT_M, width]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={COLORS.wall} roughness={0.85} />
      </mesh>
      <TierFaces panels={tierPanels} />
      {block.cells.map((cell, i) => {
        // Drawn tier by tier by TierFaces instead.
        if (isSplit(cell, i)) return null;
        const key = cell.plot?.id ?? cell.label;
        const isSelected = selectedKey != null && (selectedKey === cell.plot?.id || selectedKey === cell.label);
        const isDimmed = cell.plot?.id != null && dimmed.has(cell.plot.id);
        const { status } = cellInfo[i];
        const matches = matchesStatusFilter(status, filter);
        const color = cellColor({
          status,
          isSelected,
          isHovered: hoveredKey === key,
          isDimmed,
          isResult: cell.plot?.id != null && resultIds.has(cell.plot.id),
          showStatus,
        });
        return (
          <mesh
            key={`${block.key}-${cell.label}`}
            geometry={UNIT_BOX}
            position={[cell.center.x, ROOF_Y - 0.06 + (isSelected ? 0.12 : 0), cell.center.z]}
            rotation={[0, rotationY, 0]}
            scale={[cell.length - 0.12, 0.14, (cell.width ?? width) - 0.16]}
            receiveShadow
          >
            <meshStandardMaterial
              color={color}
              roughness={0.7}
              transparent={!matches}
              opacity={matches ? 1 : 0.3}
            />
          </mesh>
        );
      })}
      <RoofLabel
        text={block.label}
        position={[center.x, ROOF_Y + 0.05, center.z]}
        rotationY={rotationY}
        maxLength={length * 0.7}
      />
    </group>
  );
}

/**
 * A directory block that has no plots in the system yet: drawn like the
 * others (niche-sized roof panels, name) but not searchable or tappable.
 */
function UnmappedBlock({ block }) {
  const { center, length, width, rotationY, name } = block;
  const panels = Math.max(1, Math.round(length / 2.65));
  const panel = length / panels;
  const dir = { x: Math.cos(rotationY), z: -Math.sin(rotationY) };
  return (
    <group>
      <mesh
        geometry={UNIT_BOX}
        position={[center.x, BLOCK_HEIGHT_M / 2, center.z]}
        rotation={[0, rotationY, 0]}
        scale={[length, BLOCK_HEIGHT_M, width]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={COLORS.wall} roughness={0.85} />
      </mesh>
      {Array.from({ length: panels }, (_, k) => {
        const a = -length / 2 + panel * (k + 0.5);
        return (
          <mesh
            key={k}
            geometry={UNIT_BOX}
            position={[center.x + dir.x * a, ROOF_Y - 0.06, center.z + dir.z * a]}
            rotation={[0, rotationY, 0]}
            scale={[panel - 0.12, 0.14, width - 0.16]}
            receiveShadow
          >
            <meshStandardMaterial color={COLORS.roof} roughness={0.7} />
          </mesh>
        );
      })}
      <RoofLabel text={name} position={[center.x, ROOF_Y + 0.05, center.z]} rotationY={rotationY} maxLength={length * 0.7} />
    </group>
  );
}

/** Teardrop pin that bobs above the chosen plot. */
function Pin({ position, label }) {
  const group = useRef();
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.position.y = position[1] + 0.35 * (1 + Math.sin(clock.elapsedTime * 3));
    invalidate();
  });
  return (
    <group>
      <group ref={group} position={position}>
        <mesh position={[0, 1.2, 0]} rotation={[Math.PI, 0, 0]} castShadow>
          <coneGeometry args={[0.55, 1.6, 24]} />
          <meshStandardMaterial color={COLORS.pin} />
        </mesh>
        <mesh position={[0, 2.15, 0]} castShadow>
          <sphereGeometry args={[0.75, 24, 16]} />
          <meshStandardMaterial color={COLORS.pin} />
        </mesh>
        <mesh position={[0, 2.15, 0.62]}>
          <sphereGeometry args={[0.28, 16, 12]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      </group>
      {label && <Tag text={label} position={[position[0], position[1] + 4.4, position[2]]} height={1.3} />}
    </group>
  );
}

/** Flat ribbon along a path, textured with dashes that slide toward the destination. */
function RouteRibbon({ points }) {
  const invalidate = useThree((s) => s.invalidate);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 8;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = COLORS.route;
    ctx.fillRect(0, 0, 40, 8);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  const { dashed, base } = useMemo(() => ribbonGeometries(points), [points]);
  useEffect(() => () => {
    dashed.dispose();
    base.dispose();
  }, [dashed, base]);

  const dashMaterial = useRef(null);
  useFrame((_, delta) => {
    const map = dashMaterial.current?.map;
    if (!map) return;
    map.offset.x -= delta * 0.8;
    invalidate();
  });

  return (
    <group>
      <mesh geometry={base} renderOrder={1}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.75} depthWrite={false} />
      </mesh>
      <mesh geometry={dashed} renderOrder={2}>
        <meshBasicMaterial ref={dashMaterial} map={texture} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

const DASH_LENGTH_M = 2.2;

function ribbonGeometries(points) {
  const make = (width, y, withUv) => {
    const positions = [];
    const uvs = [];
    const index = [];
    let run = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const nx = (-dz / len) * (width / 2);
      const nz = (dx / len) * (width / 2);
      const start = positions.length / 3;
      positions.push(a.x + nx, y, a.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz);
      const u0 = run / DASH_LENGTH_M;
      const u1 = (run + len) / DASH_LENGTH_M;
      if (withUv) uvs.push(u0, 1, u0, 0, u1, 1, u1, 0);
      index.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
      run += len;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (withUv) geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    return geo;
  };
  return { base: make(1.0, 0.05, false), dashed: make(0.55, 0.07, true) };
}

/** Tileable canvas texture: a base colour with soft patches and fine specks. */
function makeSurfaceTexture({ base, specks, patches = [], joints = null, size = 256, seed = 3 }) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (const color of patches) {
    for (let i = 0; i < 14; i++) {
      const r = size * (0.08 + rand() * 0.18);
      const x = rand() * size;
      const y = rand() * size;
      // Drawn on all nine neighbouring tiles so the edges repeat seamlessly.
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, color);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
  }
  for (let i = 0; i < (size * size) / 5; i++) {
    ctx.globalAlpha = 0.12 + rand() * 0.25;
    ctx.fillStyle = specks[Math.floor(rand() * specks.length)];
    const d = 1 + rand() * 2;
    ctx.fillRect(rand() * size, rand() * size, d, d);
  }
  ctx.globalAlpha = 1;
  if (joints) {
    ctx.strokeStyle = joints;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const ROAD_TILE_M = 8;

/** A flat road strip along `points`, with round joints so bends have no gaps. */
function roadGeometry(points, width) {
  const positions = [];
  const uvs = [];
  const index = [];
  const half = width / 2;
  let run = 0;
  const add = (x, z, u, v) => {
    positions.push(x, 0, z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-3) continue;
    const nx = (-(b.z - a.z) / len) * half;
    const nz = ((b.x - a.x) / len) * half;
    const u0 = run / ROAD_TILE_M;
    const u1 = (run + len) / ROAD_TILE_M;
    const v0 = add(a.x + nx, a.z + nz, u0, 1);
    const v1 = add(a.x - nx, a.z - nz, u0, 0);
    const v2 = add(b.x + nx, b.z + nz, u1, 1);
    const v3 = add(b.x - nx, b.z - nz, u1, 0);
    index.push(v0, v2, v1, v1, v2, v3);
    run += len;
    if (i < points.length - 2) {
      const c = add(b.x, b.z, u1, 0.5);
      const steps = 12;
      for (let k = 0; k < steps; k++) {
        const t0 = (k / steps) * Math.PI * 2;
        const t1 = ((k + 1) / steps) * Math.PI * 2;
        const p0 = add(b.x + Math.cos(t0) * half, b.z + Math.sin(t0) * half, u1, 0.5);
        const p1 = add(b.x + Math.cos(t1) * half, b.z + Math.sin(t1) * half, u1, 0.5);
        index.push(c, p1, p0);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Grass everywhere, the concrete yard under the rows, and the roads. */
function Ground({ paving, roads }) {
  const textures = useMemo(() => {
    const grass = makeSurfaceTexture({
      base: "#7d9a58",
      specks: ["#5f7f3f", "#93ad6a", "#6d8a4a", "#a8a27a"],
      patches: ["rgba(156,146,96,0.35)", "rgba(78,108,52,0.35)"],
      seed: 5,
    });
    grass.repeat.set(3000 / 14, 3000 / 14);
    const concrete = makeSurfaceTexture({
      base: "#d9d5cc",
      specks: ["#c4bfb4", "#ebe7df", "#b6b1a6"],
      patches: ["rgba(168,158,142,0.25)"],
      joints: "rgba(150,144,132,0.7)",
      seed: 9,
    });
    // Shape UVs are in metres: one 5 m slab per tile.
    concrete.repeat.set(1 / 5, 1 / 5);
    const road = makeSurfaceTexture({
      base: "#9a978f",
      specks: ["#86837c", "#aeaba3", "#77746d"],
      patches: ["rgba(110,106,98,0.3)"],
      seed: 13,
    });
    return { grass, concrete, road };
  }, []);
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures]);

  const pavingGeometry = useMemo(() => {
    if (paving.length < 3) return null;
    // ShapeGeometry lies in XY; turned flat, shape y becomes -z.
    return new THREE.ShapeGeometry(new THREE.Shape(paving.map((p) => new THREE.Vector2(p.x, -p.z))));
  }, [paving]);
  useEffect(() => () => pavingGeometry?.dispose(), [pavingGeometry]);

  const roadGeometries = useMemo(() => roads.map((r) => roadGeometry(r.points, r.width)), [roads]);
  useEffect(() => () => roadGeometries.forEach((g) => g.dispose()), [roadGeometries]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3000, 3000]} />
        <meshStandardMaterial map={textures.grass} roughness={1} />
      </mesh>
      {roadGeometries.map((geometry, i) => (
        <mesh key={i} geometry={geometry} position={[0, 0.015, 0]} receiveShadow>
          <meshStandardMaterial map={textures.road} roughness={0.95} />
        </mesh>
      ))}
      {pavingGeometry && (
        <mesh geometry={pavingGeometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
          <meshStandardMaterial map={textures.concrete} roughness={0.95} />
        </mesh>
      )}
    </group>
  );
}

/** Instanced trees and houses, plus the commercial building. */
function Surroundings({ buildings, walls = [], houses, trees }) {
  const treeMesh = useRef();
  const wallMesh = useRef();
  const roofMesh = useRef();

  useEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    if (treeMesh.current) {
      trees.forEach((t, i) => {
        m.compose(new THREE.Vector3(t.x, t.r * 0.85 + 0.6, t.z), q.identity(), new THREE.Vector3(t.r, t.r * 0.85, t.r));
        treeMesh.current.setMatrixAt(i, m);
        treeMesh.current.setColorAt(i, color.setHSL(0.28 + t.hue, 0.5, 0.2 + t.light));
      });
      treeMesh.current.instanceMatrix.needsUpdate = true;
      if (treeMesh.current.instanceColor) treeMesh.current.instanceColor.needsUpdate = true;
    }
    if (wallMesh.current && roofMesh.current) {
      houses.forEach((h, i) => {
        q.setFromAxisAngle(up, h.angle);
        m.compose(new THREE.Vector3(h.x, h.h / 2, h.z), q, new THREE.Vector3(h.w, h.h, h.d));
        wallMesh.current.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(h.x, h.h + 0.8, h.z), q, new THREE.Vector3(h.w + 0.6, 1.6, h.d + 0.6));
        roofMesh.current.setMatrixAt(i, m);
        roofMesh.current.setColorAt(i, color.set(h.roof));
      });
      wallMesh.current.instanceMatrix.needsUpdate = true;
      roofMesh.current.instanceMatrix.needsUpdate = true;
      if (roofMesh.current.instanceColor) roofMesh.current.instanceColor.needsUpdate = true;
    }
  }, [trees, houses]);

  // A square pyramid with a 1 x 1 base, for hip roofs.
  const roofGeometry = useMemo(() => {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
    g.rotateY(Math.PI / 4);
    return g;
  }, []);
  useEffect(() => () => roofGeometry.dispose(), [roofGeometry]);

  return (
    <group>
      {buildings.map((b, i) => {
        const rot = (b.angleDeg * Math.PI) / 180;
        // Shop fronts face the cemetery (south side of the building).
        const front = { x: b.x + Math.sin(rot) * (b.width / 2), z: b.z + Math.cos(rot) * (b.width / 2) };
        if (b.sign) {
          return (
            <group key={`${b.label}-${i}`}>
              <mesh geometry={UNIT_BOX} position={[b.x, b.height / 2, b.z]} rotation={[0, rot, 0]} scale={[b.length, b.height, b.width]} castShadow receiveShadow>
                <meshStandardMaterial color="#e9e6df" roughness={0.85} />
              </mesh>
              <mesh geometry={UNIT_BOX} position={[b.x, b.height + 0.12, b.z]} rotation={[0, rot, 0]} scale={[b.length + 0.5, 0.24, b.width + 0.5]} castShadow>
                <meshStandardMaterial color="#9aa1aa" roughness={0.7} />
              </mesh>
              <Tag text={b.label.toUpperCase()} position={[b.x, b.height + 2, b.z]} color="#111827" background="#facc15" height={1.3} />
            </group>
          );
        }
        // Points along the front, from the east end (0) to the west end (1).
        const alongFront = (t) => {
          const a = (0.5 - t) * b.length;
          return [front.x + Math.cos(rot) * a, b.height + 1.4, front.z - Math.sin(rot) * a];
        };
        return (
          <group key={`${b.label}-${i}`}>
            <mesh
              geometry={UNIT_BOX}
              position={[b.x, b.height / 2, b.z]}
              rotation={[0, rot, 0]}
              scale={[b.length, b.height, b.width]}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial color="#eceae5" roughness={0.85} />
            </mesh>
            <mesh geometry={UNIT_BOX} position={[b.x, b.height + 0.15, b.z]} rotation={[0, rot, 0]} scale={[b.length + 0.6, 0.3, b.width + 0.6]} castShadow>
              <meshStandardMaterial color="#c3c7cc" roughness={0.7} />
            </mesh>
            <mesh geometry={UNIT_BOX} position={[front.x, 1.4, front.z]} rotation={[0, rot, 0]} scale={[b.length - 2, 2.6, 0.12]}>
              <meshStandardMaterial color="#5d6c7d" roughness={0.5} />
            </mesh>
            <RoofLabel
              text={b.label.toUpperCase()}
              position={[b.x, b.height + 0.32, b.z]}
              rotationY={rot}
              maxLength={b.length * 0.5}
            />
            {(b.sections || []).map((s) => (
              <Tag key={s.label} text={s.label} position={alongFront(s.at)} color="#0f172a" background="#2dd4bf" height={1.2} />
            ))}
          </group>
        );
      })}
      {walls.map((w, i) => (
        <group key={`wall-${i}`}>
          {w.points.slice(0, -1).map((a, k) => {
            const b = w.points[k + 1];
            const len = Math.hypot(b.x - a.x, b.z - a.z);
            return (
              <mesh
                key={k}
                geometry={UNIT_BOX}
                position={[(a.x + b.x) / 2, w.height / 2, (a.z + b.z) / 2]}
                rotation={[0, Math.atan2(-(b.z - a.z), b.x - a.x), 0]}
                scale={[len + w.width, w.height, w.width]}
                castShadow
                receiveShadow
              >
                <meshStandardMaterial color="#d8d4cc" roughness={0.85} />
              </mesh>
            );
          })}
          {w.labels.map((l) => (
            <Tag key={l.label} text={l.label} position={[l.x, w.height + 1.6, l.z]} color="#0f172a" background="#2dd4bf" height={1.2} />
          ))}
        </group>
      ))}
      {houses.length > 0 && (
        <>
          <instancedMesh ref={wallMesh} args={[UNIT_BOX, undefined, houses.length]} castShadow receiveShadow>
            <meshStandardMaterial color="#e7e1d6" roughness={0.9} />
          </instancedMesh>
          <instancedMesh ref={roofMesh} args={[roofGeometry, undefined, houses.length]} castShadow>
            <meshStandardMaterial roughness={0.6} flatShading />
          </instancedMesh>
        </>
      )}
      {trees.length > 0 && (
        <instancedMesh ref={treeMesh} args={[undefined, undefined, trees.length]} castShadow>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial flatShading roughness={0.9} />
        </instancedMesh>
      )}
    </group>
  );
}

/** A sign post with a yellow board at the route start (the configured start point). */
function Landmark({ position, label }) {
  return (
    <group>
      <mesh position={[position.x, 2.5, position.z]} castShadow>
        <cylinderGeometry args={[0.12, 0.12, 5, 8]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <Tag text={label.toUpperCase()} position={[position.x, 5.6, position.z]} color="#111827" background="#facc15" height={1.4} />
    </group>
  );
}

/**
 * The walker is life-size (about 1.75 m) when the camera is close. From
 * further away it grows a little — never past WALKER_MAX_SCALE — so it can
 * still be found on the overview; nobody judges its height from up there.
 */
const WALKER_NEAR_M = 45;
const WALKER_MAX_SCALE = 2.6;
// The tag stays between these heights on screen: readable from the
// overview, never dominating the map when zoomed in.
const WALKER_TAG_MIN_PX = 13;
const WALKER_TAG_MAX_PX = 18;
const WALKER_DISC_MIN_PX = 10;
const WALKER_TAG_M = 0.5;
const WALKER_DISC_M = 0.72;
const WALKER_COLORS = {
  shirt: "#2563eb",
  trousers: "#273449",
  shoes: "#3b2a20",
  skin: "#e0ac85",
  hair: "#2b1d14",
};

const skinMaterial = { color: WALKER_COLORS.skin, roughness: 0.85 };

/**
 * "You're here": a person who walks to each new position (from the visitor's
 * live GPS, or the route's start point), turns to face the way they are
 * going, swings arms and legs while moving and stands still otherwise. A
 * pulsing ring shows the position is live.
 */
function Walker({ position, heading = null, live = false }) {
  const root = useRef();
  const sizer = useRef();
  const disc = useRef();
  const tag = useRef();
  const figure = useRef();
  const body = useRef();
  const legL = useRef();
  const legR = useRef();
  const armL = useRef();
  const armR = useRef();
  const pulse = useRef();
  const motion = useRef({ placed: false, phase: 0, swing: 0, size: 1 });
  const invalidate = useThree((s) => s.invalidate);
  const target = useMemo(() => new THREE.Vector3(position.x, 0, position.z), [position.x, position.z]);
  // Compass bearing (0 = north, clockwise) to a turn of the figure, which faces +z.
  const facing = heading == null ? null : Math.PI - (heading * Math.PI) / 180;

  useEffect(() => invalidate(), [target, facing, live, invalidate]);

  useFrame(({ clock, camera, size }, delta) => {
    const g = root.current;
    if (!g) return;
    const m = motion.current;
    const dt = Math.min(delta, 0.1);
    if (!m.placed) {
      g.position.copy(target);
      m.placed = true;
    }
    const gap = g.position.distanceTo(target);
    const moving = gap > 0.05;
    if (moving) {
      g.position.lerp(target, 1 - Math.exp(-2.5 * dt));
      // While walking without a compass heading, face the way the figure moves.
      if (facing === null) {
        const dir = target.clone().sub(g.position);
        figure.current.rotation.y += shortestAngle(figure.current.rotation.y, Math.atan2(dir.x, dir.z)) * (1 - Math.exp(-6 * dt));
      }
    }
    if (facing !== null) {
      figure.current.rotation.y += shortestAngle(figure.current.rotation.y, facing) * (1 - Math.exp(-6 * dt));
    }

    // Life-size up close, a little larger from far away.
    const distance = camera.position.distanceTo(g.position);
    const want = THREE.MathUtils.clamp(distance / WALKER_NEAR_M, 1, WALKER_MAX_SCALE);
    m.size += (want - m.size) * (1 - Math.exp(-10 * dt));
    sizer.current.scale.setScalar(m.size);

    // The tag and ground disc are sized in screen pixels, so the spot is
    // easy to find from the default view without a giant figure.
    const metresPerPx = (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov ?? 45) / 2)) / Math.max(1, size.height);
    const tagHeight = THREE.MathUtils.clamp(
      WALKER_TAG_M * m.size,
      WALKER_TAG_MIN_PX * metresPerPx,
      WALKER_TAG_MAX_PX * metresPerPx
    );
    tag.current.scale.setScalar(tagHeight / WALKER_TAG_M);
    tag.current.position.y = 1.9 * m.size + tagHeight * 0.75;
    disc.current.scale.setScalar(Math.max(m.size, (WALKER_DISC_MIN_PX * metresPerPx) / WALKER_DISC_M));

    // Stride: arms and legs swing while moving and settle when standing; the
    // body rises slightly on each step.
    m.phase += moving ? dt * 7 : 0;
    m.swing += ((moving ? 1 : 0) - m.swing) * (1 - Math.exp(-8 * dt));
    const s = Math.sin(m.phase) * 0.5 * m.swing;
    legL.current.rotation.x = s;
    legR.current.rotation.x = -s;
    armL.current.rotation.x = -s * 0.8;
    armR.current.rotation.x = s * 0.8;
    body.current.position.y = Math.abs(Math.sin(m.phase)) * 0.025 * m.swing;

    if (pulse.current) {
      const t = (clock.elapsedTime % 1.6) / 1.6;
      pulse.current.scale.setScalar(1 + t * 1.2);
      pulse.current.material.opacity = 0.45 * (1 - t);
    }
    if (moving || live || m.swing > 0.01 || Math.abs(want - m.size) > 0.005) invalidate();
  });

  return (
    <group ref={root}>
      {/* Ground marker: a blue disc on a white rim, plus a live pulse. */}
      <group ref={disc}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <circleGeometry args={[WALKER_DISC_M, 40]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
          <circleGeometry args={[0.56, 40]} />
          <meshBasicMaterial color="#2563eb" />
        </mesh>
        {live && (
          <mesh ref={pulse} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
            <ringGeometry args={[0.72, 0.88, 48]} />
            <meshBasicMaterial color="#2563eb" transparent opacity={0.45} depthWrite={false} />
          </mesh>
        )}
      </group>

      <group ref={sizer}>
        {/* An adult about 1.75 m tall, facing +z. */}
        <group ref={figure}>
          <group ref={body}>
            {/* Legs swing from the hips; shoes go with them. */}
            {[
              [legL, -0.095],
              [legR, 0.095],
            ].map(([ref, x]) => (
              <group key={x} ref={ref} position={[x, 0.93, 0]}>
                <mesh position={[0, -0.43, 0]} castShadow>
                  <capsuleGeometry args={[0.068, 0.74, 4, 10]} />
                  <meshStandardMaterial color={WALKER_COLORS.trousers} roughness={0.8} />
                </mesh>
                <mesh position={[0, -0.885, 0.045]} castShadow>
                  <boxGeometry args={[0.1, 0.07, 0.25]} />
                  <meshStandardMaterial color={WALKER_COLORS.shoes} roughness={0.7} />
                </mesh>
              </group>
            ))}

            {/* Hips and a chest that is narrower front to back than side to side. */}
            <mesh position={[0, 0.97, 0]} scale={[1, 1, 0.7]} castShadow>
              <cylinderGeometry args={[0.165, 0.165, 0.14, 16]} />
              <meshStandardMaterial color={WALKER_COLORS.trousers} roughness={0.8} />
            </mesh>
            <mesh position={[0, 1.27, 0]} scale={[1, 1, 0.62]} castShadow>
              <cylinderGeometry args={[0.2, 0.16, 0.48, 16]} />
              <meshStandardMaterial color={WALKER_COLORS.shirt} roughness={0.75} />
            </mesh>
            <mesh position={[0, 1.49, 0]} scale={[1, 0.45, 0.62]} castShadow>
              <sphereGeometry args={[0.2, 16, 10]} />
              <meshStandardMaterial color={WALKER_COLORS.shirt} roughness={0.75} />
            </mesh>

            {/* Arms swing from the shoulders: short sleeve, forearm, hand. */}
            {[
              [armL, -0.215, 0.05],
              [armR, 0.215, -0.05],
            ].map(([ref, x, tilt]) => (
              <group key={x} ref={ref} position={[x, 1.47, 0]} rotation={[0, 0, tilt]}>
                <mesh position={[0, -0.14, 0]} castShadow>
                  <capsuleGeometry args={[0.052, 0.2, 4, 10]} />
                  <meshStandardMaterial color={WALKER_COLORS.shirt} roughness={0.75} />
                </mesh>
                <mesh position={[0, -0.39, 0]} castShadow>
                  <capsuleGeometry args={[0.04, 0.26, 4, 10]} />
                  <meshStandardMaterial {...skinMaterial} />
                </mesh>
                <mesh position={[0, -0.58, 0]} castShadow>
                  <sphereGeometry args={[0.045, 12, 10]} />
                  <meshStandardMaterial {...skinMaterial} />
                </mesh>
              </group>
            ))}

            {/* Neck, head and hair. */}
            <mesh position={[0, 1.555, 0]}>
              <cylinderGeometry args={[0.048, 0.055, 0.09, 12]} />
              <meshStandardMaterial {...skinMaterial} />
            </mesh>
            <mesh position={[0, 1.67, 0]} scale={[0.9, 1.08, 0.97]} castShadow>
              <sphereGeometry args={[0.105, 20, 16]} />
              <meshStandardMaterial {...skinMaterial} />
            </mesh>
            <mesh position={[0, 1.685, -0.008]} scale={[0.93, 1.08, 1]}>
              <sphereGeometry args={[0.108, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
              <meshStandardMaterial color={WALKER_COLORS.hair} roughness={0.9} />
            </mesh>
          </group>
        </group>

      </group>

      {/* Above the head, clear of the figure when seen from above. */}
      <group ref={tag}>
        <Tag text="YOU'RE HERE" position={[0, 0, 0]} background="#ea580c" height={WALKER_TAG_M} />
      </group>
    </group>
  );
}

/** Camera + MapControls, with smooth fly-to for focus, routes and the buttons. */
function CameraRig({ apiRef, home, focus, keysRef, onHeading }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const controlsRef = useRef(null);
  const anim = useRef(null);
  const lastHeading = useRef(null);
  const keyVelocity = useRef(STILL);
  const lastKeyFrame = useRef(null);

  useEffect(() => {
    const controls = new MapControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = false;
    controls.minDistance = 6;
    controls.maxDistance = 650;
    controls.maxPolarAngle = 1.25;
    controls.addEventListener("change", invalidate);
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, invalidate]);

  useEffect(() => {
    function current() {
      const controls = controlsRef.current;
      const offset = camera.position.clone().sub(controls.target);
      const s = new THREE.Spherical().setFromVector3(offset);
      return { target: controls.target.clone(), distance: s.radius, polar: s.phi, azimuth: s.theta };
    }
    apiRef.current = {
      flyTo({ x, z, distance, fitRadius, polar, azimuth, instant = false }) {
        if (!controlsRef.current) return;
        const from = current();
        const to = {
          target: new THREE.Vector3(x ?? from.target.x, 0, z ?? from.target.z),
          distance: distance ?? (fitRadius != null ? fitDistance(fitRadius, camera.aspect) : from.distance),
          polar: polar ?? from.polar,
          azimuth: azimuth ?? from.azimuth,
        };
        anim.current = { from, to, start: performance.now(), duration: instant ? 0 : 750 };
        invalidate();
      },
      zoom(factor) {
        if (!controlsRef.current) return;
        apiRef.current.flyTo({ distance: Math.min(650, Math.max(6, current().distance * factor)) });
      },
      /** Turns the view by `radians` (positive = to the right). */
      turn(radians) {
        if (!controlsRef.current) return;
        apiRef.current.flyTo({ azimuth: current().azimuth - radians });
      },
      /** Turns back to the printed directory's heading. */
      faceHome() {
        apiRef.current.flyTo({ azimuth: HOME_AZIMUTH });
      },
      /** Flies to a point on the ground and moves in closer. */
      zoomInAt(x, z) {
        if (!controlsRef.current) return;
        apiRef.current.flyTo({ x, z, distance: Math.max(12, current().distance * 0.55) });
      },
      /** Wakes the render loop (frames are drawn only on demand). */
      wake() {
        anim.current = null;
        invalidate();
      },
      isTopView() {
        return controlsRef.current ? current().polar < 0.3 : false;
      },
    };
  }, [apiRef, camera, invalidate]);

  // First view: the whole site, tilted like the printed directory. Only once,
  // so plots loading later never pull the camera away from the visitor.
  const homed = useRef(false);
  useEffect(() => {
    if (homed.current || !home) return;
    homed.current = true;
    apiRef.current?.flyTo({ ...home, polar: TILT_POLAR, azimuth: HOME_AZIMUTH, instant: true });
  }, [apiRef, home]);

  // Fly to a chosen plot or frame a route. Keyed by value, so a parent
  // re-render with an equal request does not fight the visitor's panning.
  // Handled here (not in the page) because the scene mounts after the page.
  const focusKey = focus?.key ?? null;
  useEffect(() => {
    if (focus) apiRef.current?.flyTo(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRef, focusKey]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    // Held keys move the view, easing in on press and gliding to a stop on release.
    // The step uses its own clock from the key press: the render loop sleeps between
    // changes, so the frame delta after a quiet spell is huge and made a tap jump.
    const keys = keysRef?.current;
    const wanted = keys ? keyActions(keys.held, keys.shift) : STILL;
    if (hasMotion(wanted) || hasMotion(keyVelocity.current)) {
      const now = performance.now();
      const dt = lastKeyFrame.current == null ? 1 / 60 : Math.min((now - lastKeyFrame.current) / 1000, MAX_STEP_S);
      lastKeyFrame.current = now;
      keyVelocity.current = easeActions(keyVelocity.current, wanted, dt);
      if (hasMotion(wanted)) anim.current = null;
      const offset = camera.position.clone().sub(controls.target);
      const s = new THREE.Spherical().setFromVector3(offset);
      const next = stepView(
        { target: { x: controls.target.x, z: controls.target.z }, distance: s.radius, polar: s.phi, azimuth: s.theta },
        keyVelocity.current,
        dt
      );
      controls.target.set(next.target.x, 0, next.target.z);
      camera.position
        .copy(controls.target)
        .add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(next.distance, next.polar, next.azimuth)));
      camera.lookAt(controls.target);
      invalidate();
    } else {
      lastKeyFrame.current = null;
    }

    const a = anim.current;
    if (a) {
      const raw = a.duration ? Math.min(1, (performance.now() - a.start) / a.duration) : 1;
      const t = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
      const target = a.from.target.clone().lerp(a.to.target, t);
      const s = new THREE.Spherical(
        THREE.MathUtils.lerp(a.from.distance, a.to.distance, t),
        THREE.MathUtils.lerp(a.from.polar, a.to.polar, t),
        a.from.azimuth + shortestAngle(a.from.azimuth, a.to.azimuth) * t
      );
      controls.target.copy(target);
      camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(s));
      camera.lookAt(target);
      if (raw >= 1) anim.current = null;
      invalidate();
    }
    if (controls.update()) invalidate();

    // Tell the compass which way the view faces (only when it changes noticeably).
    if (onHeading) {
      const heading = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)).theta;
      if (lastHeading.current == null || Math.abs(shortestAngle(lastHeading.current, heading)) > 0.01) {
        lastHeading.current = heading;
        onHeading(heading);
      }
    }
  });

  return null;
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function distanceToFit(radius) {
  return Math.max(25, (radius / Math.tan(((FOV / 2) * Math.PI) / 180)) * 0.7);
}

/** Camera distance that keeps a circle of `radius` on screen, on any canvas shape (phones are narrow). */
function fitDistance(radius, aspect = 1) {
  const half = ((FOV / 2) * Math.PI) / 180;
  const narrowest = Math.atan(Math.tan(half) * Math.min(1, aspect || 1));
  return THREE.MathUtils.clamp((radius / Math.tan(narrowest)) * 0.9, 18, 650);
}

/** How steeply the route view looks down: low enough to see the plot's niche wall. */
const ROUTE_VIEW_POLAR = 0.95;
// Beyond this half-length the route view centres near the plot rather than on the whole walk.
const ROUTE_VIEW_MAX_REACH_M = 14;

function Scene({ blocks, paving, surroundings, unmapped, apiRef, keysRef, onHeading, home, focus, routePoints, pinPosition, youAreHere, walkerHeading, walkerLive, landmark, blockProps }) {
  const shadowSize = home ? Math.max(60, home.radius * 1.6) : 120;
  return (
    <>
      <color attach="background" args={[COLORS.sky]} />
      <fog attach="fog" args={[COLORS.sky, 280, 950]} />
      <hemisphereLight args={["#ffffff", COLORS.grass, 1.1]} />
      <directionalLight
        position={[-45, 90, 60]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowSize}
        shadow-camera-right={shadowSize}
        shadow-camera-top={shadowSize}
        shadow-camera-bottom={-shadowSize}
        shadow-camera-far={400}
        shadow-bias={-0.0005}
      />
      {/* Double-click the ground to fly in to that spot. */}
      <group
        onDoubleClick={(e) => {
          e.stopPropagation();
          apiRef.current?.zoomInAt(e.point.x, e.point.z);
        }}
      >
        <Ground paving={paving} roads={surroundings.roads} />
      </group>
      <Surroundings
        buildings={surroundings.buildings}
        walls={surroundings.walls}
        houses={surroundings.houses}
        trees={surroundings.trees}
      />
      {unmapped.map((block) => (
        <UnmappedBlock key={block.name} block={block} />
      ))}
      {blocks.map((block) => (
        <Block key={block.key} block={block} {...blockProps} />
      ))}
      {/* Where the visitor stands at the start point, "You're here" replaces its sign, as on the printed map. */}
      {landmark &&
        !(youAreHere && Math.hypot(youAreHere.x - landmark.position.x, youAreHere.z - landmark.position.z) < 3) && (
          <Landmark position={landmark.position} label={landmark.label} />
        )}
      {youAreHere && <Walker position={youAreHere} heading={walkerHeading} live={walkerLive} />}
      {routePoints.length > 1 && <RouteRibbon points={routePoints} />}
      {pinPosition && <Pin position={pinPosition} />}
      <CameraRig apiRef={apiRef} home={home} focus={focus} keysRef={keysRef} onHeading={onHeading} />
    </>
  );
}

// Size and shape; the colours (dark or light theme) come from .map3d-btn.
const BUTTON_STYLE = {
  width: 38,
  height: 38,
  display: "grid",
  placeItems: "center",
  borderRadius: 8,
  cursor: "pointer",
};

export default function CemeteryMap3D(props) {
  const [webgl] = useState(hasWebGL);
  if (!webgl) {
    // No switch back to 3D here: this device cannot show it.
    const { showYouAreHere: _unused, onMapModeChange: _noSwitch, showStatus: _status, ...flatProps } = props;
    return <FlatMap {...flatProps} />;
  }
  return <CemeteryScene3D {...props} />;
}

function CemeteryScene3D({
  plots = [],
  selectedPlot = null,
  onSelectPlot,
  routeCoords = null,
  focusPoint = null,
  statusFilter = "all",
  onStatusFilterChange,
  dimmedPlotIds = null,
  showLegend = true,
  // Colour plots by status and tier; defaults to the legend's setting. The public
  // map shows the colours with a small fixed key instead of the filter legend.
  showStatus = showLegend,
  gridAngle = DEFAULT_GRID_ANGLE_DEG,
  showYouAreHere = false,
  // The visitor's live GPS position ({ lat, lng, heading }); moves the walker.
  userPosition = null,
  onMapModeChange,
}) {
  const apiRef = useRef(null);
  // Keys held while the map has focus; read every frame by the camera.
  const keysRef = useRef({ held: new Set(), shift: false });
  const compassRef = useRef(null);
  const [showHelp, setShowHelp] = useState(false);
  const [narrowKey] = useState(() => window.matchMedia("(max-width: 640px)").matches);
  const [keyOpen, setKeyOpen] = useState(!narrowKey);
  const [showHint, setShowHint] = useState(true);
  const [touchDevice] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  // The compass needle points to north on screen; updated directly, not through React state,
  // because it changes every frame while the view turns.
  const onHeading = useCallback((heading) => {
    if (compassRef.current) compassRef.current.style.transform = `rotate(${(heading * 180) / Math.PI}deg)`;
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 9000);
    return () => clearTimeout(timer);
  }, []);
  const [hovered, setHovered] = useState(null);
  const [localFilter, setLocalFilter] = useState("all");
  const [topView, setTopView] = useState(false);
  const filter = String(statusFilter !== "all" ? statusFilter : localFilter).toLowerCase();

  const layout = useMemo(
    () => buildSceneLayout({ plots, preset: LAYOUT_PRESET, gridAngle }),
    [plots, gridAngle]
  );
  const ref = layout.ref;

  // Directory blocks with no plots yet; then every block straightened into the
  // cemetery's regular grid for display (parallel rows, even row lines, aligned ends).
  const unmapped = useMemo(() => placeUnmappedBlocks(ref, layout.blocks), [ref, layout.blocks]);
  // The grid follows the GPS-surveyed rows; rows traced from the photo are snapped onto it.
  const tidy = useMemo(
    () => regularizeBlocks(layout.blocks, unmapped, { isReference: (b) => !TRACED_ROW_KEYS.has(b.key) }),
    [layout.blocks, unmapped]
  );

  const dimmed = useMemo(
    () => (dimmedPlotIds instanceof Set ? dimmedPlotIds : new Set(dimmedPlotIds || [])),
    [dimmedPlotIds]
  );
  const resultIds = useMemo(() => new Set(plots.map((p) => p.id).filter((id) => id != null)), [plots]);

  const selectedKey = selectedPlot?.id ?? selectedPlot?.plotNumber ?? null;
  const selectedCell = useMemo(() => {
    if (selectedKey == null) return null;
    for (const block of tidy.mapped) {
      const cell = block.cells.find((c) => c.plot?.id === selectedKey || c.label === selectedKey || c.label === selectedPlot?.plotNumber);
      if (cell) return cell;
    }
    return null;
  }, [tidy.mapped, selectedKey, selectedPlot?.plotNumber]);

  const routePoints = useMemo(() => {
    if (!ref || !Array.isArray(routeCoords)) return [];
    return routeCoords
      .filter((c) => Array.isArray(c) && c.length === 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
      .map(([lat, lng]) => toLocal(ref, { lat: Number(lat), lng: Number(lng) }));
  }, [routeCoords, ref]);

  const landmark = useMemo(
    () => (ref ? { position: toLocal(ref, KIOSK_START_POINT), label: KIOSK_START_POINT.label } : null),
    [ref]
  );
  // The concrete yard under all blocks (traced, or a little wider than them) and everything around it.
  const paving = useMemo(() => {
    const yard = siteYard(ref);
    if (yard.length >= 3) return yard;
    return growFootprint(hull2d([...layout.footprint, ...unmapped.flatMap((b) => b.corners)]), 7);
  }, [ref, layout.footprint, unmapped]);
  const surroundings = useMemo(
    () =>
      placeSurroundings({
        ref,
        paving,
        clear: landmark ? [{ x: landmark.position.x, z: landmark.position.z, r: 10 }] : [],
      }),
    [ref, paving, landmark]
  );

  // First view: the whole paved park and the buildings along it.
  const home = useMemo(() => {
    if (paving.length < 3) return null;
    const buildingEnds = surroundings.buildings.flatMap((b) => {
      const rad = (b.angleDeg * Math.PI) / 180;
      const dx = (Math.cos(rad) * b.length) / 2;
      const dz = (-Math.sin(rad) * b.length) / 2;
      return [
        { x: b.x + dx, z: b.z + dz },
        { x: b.x - dx, z: b.z - dz },
      ];
    });
    const pts = [...paving, ...buildingEnds];
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const radius = Math.max(maxX - minX, maxZ - minZ) / 2;
    // Nudged toward the camera (north) so the tilt does not crop the commercial building.
    const z = (minZ + maxZ) / 2 - radius * 0.1;
    return { x: (minX + maxX) / 2, z, radius, distance: distanceToFit(radius) * 1.25 };
  }, [paving, surroundings]);

  // "You're here": the visitor's live position when there is one, else the
  // route's start, else (public map) the start point itself.
  const liveLocal = useMemo(
    () => (ref && userPosition ? toLocal(ref, userPosition) : null),
    [ref, userPosition]
  );
  // The route as drawn: the 3D map lines its blocks up for display, so a
  // route planned on their real (GPS) positions can cut across a drawn block.
  // It is planned again, the same way, round the blocks as they are drawn:
  // same start, same face of the plot. Falls back to the route as given.
  const shownRoute = useMemo(() => {
    if (!ref || routePoints.length < 2 || !selectedCell) return routePoints;
    return (
      sceneWalk({ ref, start: routePoints[0], plot: selectedCell.center, blocks: tidy.mapped, buildings: surroundings.buildings }) ||
      routePoints
    );
  }, [ref, routePoints, selectedCell, tidy.mapped, surroundings.buildings]);

  const youAreHere =
    liveLocal || (routePoints.length > 1 ? routePoints[0] : showYouAreHere && landmark ? landmark.position : null);

  // The outer wall that holds the chosen plot's niches: its own face on a
  // back-to-back block (A or B), else whichever wall faces the route start.
  const selectedWall = useMemo(() => {
    if (!selectedCell) return null;
    const block = tidy.mapped.find((b) => b.cells.includes(selectedCell));
    if (!block) return null;
    const nx = Math.sin(block.rotationY);
    const nz = Math.cos(block.rotationY);
    const start = routePoints[0];
    const off = (selectedCell.center.x - block.center.x) * nx + (selectedCell.center.z - block.center.z) * nz;
    const toStart = start ? (start.x - selectedCell.center.x) * nx + (start.z - selectedCell.center.z) * nz : 1;
    const side = (block.faces ?? 1) > 1 ? (off >= 0 ? 1 : -1) : toStart >= 0 ? 1 : -1;
    return { nx: nx * side, nz: nz * side };
  }, [tidy.mapped, selectedCell, routePoints]);

  // Where the camera should go: the whole route when there is one, else the chosen plot.
  const focusLat = focusPoint?.lat;
  const focusLng = focusPoint?.lng;
  const focus = useMemo(() => {
    if (!ref) return null;
    if (routePoints.length > 1 && selectedCell && selectedWall) {
      // Route view: stand on the side of the plot's niche wall and look at it,
      // tilted so the wall shows, with the walker's start and the plot in frame.
      // Short walks keep both ends in frame; on long ones the view stays near
      // the plot (its wall must be readable) and shows the last part of the walk.
      const start = routePoints[0];
      const end = selectedCell.center;
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      const reach = Math.min(length / 2, ROUTE_VIEW_MAX_REACH_M);
      const along = length > 0 ? reach / length : 0;
      const radius = Math.max(16, reach + 10);
      return {
        key: `route-wall:${routePoints.length}:${start.x.toFixed(1)}:${end.x.toFixed(1)}:${selectedWall.nx.toFixed(2)}`,
        x: end.x + (start.x - end.x) * along,
        z: end.z + (start.z - end.z) * along,
        fitRadius: radius,
        polar: ROUTE_VIEW_POLAR,
        azimuth: Math.atan2(selectedWall.nx, selectedWall.nz),
      };
    }
    if (routePoints.length > 1) {
      const hull = hull2d(routePoints);
      const xs = hull.map((p) => p.x);
      const zs = hull.map((p) => p.z);
      const radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 10;
      return {
        key: `route:${routePoints.length}:${routePoints[0].x.toFixed(1)}:${routePoints.at(-1).z.toFixed(1)}`,
        x: (Math.max(...xs) + Math.min(...xs)) / 2,
        z: (Math.max(...zs) + Math.min(...zs)) / 2,
        distance: Math.min(650, distanceToFit(radius)),
        // Nearly straight down, so the commercial building does not hide the walk along its front.
        polar: 0.3,
      };
    }
    if (Number.isFinite(focusLat) && Number.isFinite(focusLng)) {
      const p = toLocal(ref, { lat: focusLat, lng: focusLng });
      return { key: `plot:${focusLat}:${focusLng}`, x: p.x, z: p.z, distance: 45, polar: 0.7 };
    }
    return null;
  }, [ref, routePoints, focusLat, focusLng, selectedCell, selectedWall]);

  if (!home) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-muted, #94a3b8)" }}>
        No mapped rows to show yet.
      </div>
    );
  }

  const blockProps = {
    selectedKey: selectedCell ? selectedCell.plot?.id ?? selectedCell.label : null,
    hoveredKey: hovered?.key ?? null,
    setHovered,
    onSelect: (plot) => typeof onSelectPlot === "function" && onSelectPlot(plot),
    showStatus,
    dimmed,
    filter,
    resultIds,
  };

  const setFilter = (next) => {
    setLocalFilter(next);
    if (typeof onStatusFilterChange === "function") onStatusFilterChange(next);
  };


  const toggleTopView = () => {
    const next = !topView;
    setTopView(next);
    apiRef.current?.flyTo({ polar: next ? TOP_POLAR : TILT_POLAR });
  };
  const showWhole = () => {
    setTopView(false);
    apiRef.current?.flyTo({ x: home.x, z: home.z, distance: home.distance, polar: TILT_POLAR, azimuth: HOME_AZIMUTH });
  };

  // Keyboard: only while the map has focus (click it first), so typing in the
  // search box never moves the map. Held keys are read every frame.
  const onKeyDown = (e) => {
    const keys = keysRef.current;
    keys.shift = e.shiftKey;
    if (e.key === "?" || (e.code === "Slash" && e.shiftKey)) {
      setShowHelp((open) => !open);
      return;
    }
    if (e.code === "KeyT") return toggleTopView();
    if (e.code === "KeyH" || e.code === "Home" || e.code === "Digit0") return showWhole();
    if (e.code === "KeyN") return apiRef.current?.faceHome();
    if (e.code === "Escape") {
      setShowHelp(false);
      return;
    }
    if (!MAP_KEY_CODES.has(e.code)) return;
    e.preventDefault();
    keys.held.add(e.code);
    setShowHint(false);
    apiRef.current?.wake();
  };
  const onKeyUp = (e) => {
    keysRef.current.held.delete(e.code);
    keysRef.current.shift = e.shiftKey;
  };
  const releaseKeys = () => {
    keysRef.current.held.clear();
    keysRef.current.shift = false;
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: "var(--radius-md, 10px)",
        overflow: "hidden",
        cursor: hovered ? "pointer" : "grab",
        outline: "none",
      }}
      data-testid="cemetery-map-3d"
      className="map3d-root"
      tabIndex={0}
      aria-label="3D cemetery map. Arrow keys move, Shift and arrows rotate and tilt, plus and minus zoom. Press ? for all controls."
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={releaseKeys}
      onPointerDown={(e) => {
        // Clicking the map gives it the keyboard; buttons keep their own focus.
        if (!e.target.closest("button")) e.currentTarget.focus({ preventScroll: true });
        setShowHint(false);
      }}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop="demand"
        camera={{ fov: FOV, near: 0.5, far: 6000, position: [home.x, home.distance, home.z - home.distance] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <Scene
          blocks={tidy.mapped}
          paving={paving}
          surroundings={surroundings}
          unmapped={tidy.drawn}
          apiRef={apiRef}
          keysRef={keysRef}
          onHeading={onHeading}
          home={home}
          focus={focus}
          routePoints={shownRoute}
          pinPosition={selectedCell ? [selectedCell.center.x, ROOF_Y, selectedCell.center.z] : null}
          youAreHere={youAreHere}
          walkerHeading={liveLocal ? userPosition.heading ?? null : null}
          walkerLive={Boolean(liveLocal)}
          landmark={landmark}
          blockProps={blockProps}
        />
      </Canvas>

      {typeof onMapModeChange === "function" && (
        <div style={{ position: "absolute", top: 12, left: 12 }}>
          <MapModeSwitch mode="3d" onChange={onMapModeChange} />
        </div>
      )}

      {hovered && (
        <div
          className="map3d-tip"
          style={{
            // Top right, clear of the 2D/3D switch on the left and the controls at the bottom.
            position: "absolute",
            right: 12,
            top: 12,
            maxWidth: "calc(100% - 140px)",
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: "0.78rem",
            fontWeight: 600,
            textAlign: "right",
            pointerEvents: "none",
          }}
        >
          Plot {hovered.label}
          {hovered.detail && <span className="map3d-tip-detail" style={{ fontWeight: 500 }}> · {hovered.detail}</span>}
        </div>
      )}

      <div style={{ position: "absolute", right: 12, bottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <button type="button" className="map3d-btn" style={BUTTON_STYLE} title="Zoom in" aria-label="Zoom in" onClick={() => apiRef.current?.zoom(0.7)}>
          <Plus size={18} />
        </button>
        <button type="button" className="map3d-btn" style={BUTTON_STYLE} title="Zoom out" aria-label="Zoom out" onClick={() => apiRef.current?.zoom(1 / 0.7)}>
          <Minus size={18} />
        </button>
        <button
          type="button"
          className="map3d-btn" style={BUTTON_STYLE}
          title={topView ? "Tilted 3D view (T)" : "Top view (T)"}
          aria-label={topView ? "Tilted 3D view" : "Top view"}
          aria-pressed={topView}
          onClick={toggleTopView}
        >
          <Layers size={18} />
        </button>
        <button
          type="button"
          className="map3d-btn" style={BUTTON_STYLE}
          title="Show the whole cemetery (H)"
          aria-label="Show the whole cemetery"
          onClick={showWhole}
        >
          <Maximize size={18} />
        </button>
      </div>

      {/* Turn the view, and a compass whose needle points north (click it to face the directory view again). */}
      <div style={{ position: "absolute", right: 58, bottom: 12, display: "flex", gap: 6 }}>
        <button type="button" className="map3d-btn" style={BUTTON_STYLE} title="Turn left (Q or Shift + ←)" aria-label="Turn left" onClick={() => apiRef.current?.turn(-Math.PI / 6)}>
          <RotateCcw size={17} />
        </button>
        <button
          type="button"
          className="map3d-btn" style={BUTTON_STYLE}
          title="Compass: the red tip points north. Click to face the directory view (N)."
          aria-label="Face the directory view"
          onClick={() => apiRef.current?.faceHome()}
        >
          <svg ref={compassRef} width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <polygon points="11,2 14,11 8,11" fill="#ef4444" />
            <polygon points="11,20 14,11 8,11" className="map3d-compass-tail" />
          </svg>
        </button>
        <button type="button" className="map3d-btn" style={BUTTON_STYLE} title="Turn right (E or Shift + →)" aria-label="Turn right" onClick={() => apiRef.current?.turn(Math.PI / 6)}>
          <RotateCw size={17} />
        </button>
        <button
          type="button"
          className="map3d-btn" style={{ ...BUTTON_STYLE, fontWeight: 800, fontSize: "1rem" }}
          title="Map controls (?)"
          aria-label="Show map controls"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((open) => !open)}
        >
          ?
        </button>
      </div>

      {showHelp && (
        <div
          role="dialog"
          aria-label="Map controls"
          className="map3d-panel"
          style={{
            position: "absolute",
            // Beside the zoom column and above the turn row, so every button stays usable.
            right: 58,
            bottom: 60,
            maxWidth: 300,
            maxHeight: "calc(100% - 80px)",
            overflowY: "auto",
            padding: "12px 14px",
            borderRadius: 10,
            fontSize: "0.78rem",
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong className="map3d-panel-title" style={{ fontSize: "0.85rem" }}>Map controls</strong>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              aria-label="Close"
              className="map3d-panel-close"
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "1rem" }}
            >
              ×
            </button>
          </div>
          {HELP_SECTIONS.map((section) => (
            <div key={section.title} style={{ marginBottom: 8 }}>
              <div className="map3d-panel-section" style={{ fontWeight: 700, marginBottom: 2 }}>{section.title}</div>
              {section.rows.map(([keys, action]) => (
                <div key={keys} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span className="map3d-panel-key" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{keys}</span>
                  <span style={{ textAlign: "right" }}>{action}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="map3d-panel-note">Click the map first so the keys reach it.</div>
        </div>
      )}

      {showHint && !hovered && (
        <div
          className="map3d-tip"
          style={{
            // Top right, like the plot tooltip; the hint hides while that shows.
            position: "absolute",
            right: 12,
            top: 12,
            maxWidth: "calc(100% - 140px)",
            textAlign: "right",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: "0.75rem",
            pointerEvents: "none",
          }}
        >
          {touchDevice
            ? "Drag to move · pinch to zoom · two fingers to turn and tilt"
            : "Drag to move · Shift + drag to turn and tilt · scroll to zoom · ? for keys"}
        </div>
      )}

      {/* Public map: a fixed key for the tier colours (no filter). */}
      {showStatus && !showLegend && (
        <div className="map3d-key">
          {[
            { key: "available", label: "Vacant tier" },
            { key: "occupied", label: "Occupied tier" },
          ].map((item) => (
            <span key={item.key} className="map3d-key-item">
              <span className="map3d-key-swatch" style={{ background: getPlotStatusColor(item.key) }} />
              {item.label}
            </span>
          ))}
        </div>
      )}

      {/* Status key (tap to filter): top left, under the 2D/3D switch; same component as the 2D map. */}
      {showLegend && (
        <MapStatusKey
          filter={filter}
          onFilter={setFilter}
          belowSwitch={typeof onMapModeChange === "function"}
          collapsible={narrowKey}
          open={keyOpen}
          onToggle={() => setKeyOpen((open) => !open)}
        />
      )}

      {/* Block types (the directory's legend): one line at the bottom left, low
          enough to stay under the controls list; scrolls sideways if too long. */}
      {showLegend && !narrowKey && (
        <div
          className="map-types-strip"
          style={{ left: 12, bottom: 12, maxWidth: "calc(100% - 270px)" }}
        >
          <BlockTypeLegend inline wrap={false} />
        </div>
      )}

    </div>
  );
}
