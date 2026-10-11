import { prisma } from "@/lib/db";
import { getBuildingKey } from "@/lib/cemetery-layout";
import { buildWalkwayNetwork } from "@/lib/walkways";

// Rows change only when the layout is edited, so the network is rebuilt at
// most once a minute rather than on every route request.
const CACHE_MS = 60_000;
let cache = null;

/** The building rows as a walkway network for routing (see walkways.js). */
export async function loadWalkwayNetwork(now = Date.now()) {
  if (cache && now - cache.at < CACHE_MS) return cache.network;
  const plots = await prisma.plot.findMany({
    where: { gpsLat: { not: null }, gpsLng: { not: null }, totalTiers: { gt: 1 } },
    select: {
      gpsLat: true,
      gpsLng: true,
      totalTiers: true,
      locationDetail: { select: { subsection: true } },
    },
  });
  const network = buildWalkwayNetwork(
    plots.map((plot) => ({
      key: getBuildingKey(plot),
      lat: Number(plot.gpsLat),
      lng: Number(plot.gpsLng),
    }))
  );
  cache = { at: now, network };
  return network;
}
