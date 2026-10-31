import { decryptGraveDetail } from "@/lib/encryption";

/**
 * Shared plot listing shape (used by `GET /api/plots` and any route that
 * returns plots to the map) and the sensitive-field policy that goes with it.
 */

/**
 * GraveDetail fields and encryption metadata that must not be exposed to
 * callers without the "verify" permission (i.e. anyone but Admin/Staff).
 */
export const PRIVATE_DETAIL_FIELDS = [
  "contactPerson",
  "contactPhone",
  "causeOfDeath",
  "notes",
  "encryptionKeyVersion",
  "notesEncrypted",
];

/** Prisma `include` for a plot as the map and drawer consume it. */
export const PLOT_LIST_INCLUDE = {
  locationDetail: { include: { location: true } },
  photos: { select: { tier: true, url: true } },
  graves: {
    select: {
      id: true,
      deceasedName: true,
      tier: true,
      status: true,
      birthDate: true,
      deathDate: true,
      burialDate: true,
      details: {
        select: {
          causeOfDeath: true,
          contactPerson: true,
          contactPhone: true,
          notes: true,
          encryptionKeyVersion: true,
          notesEncrypted: true,
        },
      },
    },
  },
};

/** Remove sensitive fields so non-staff callers never receive them (encrypted or plain). */
export function stripSensitiveDetail(detail) {
  if (!detail) return detail;
  const result = { ...detail };
  for (const field of PRIVATE_DETAIL_FIELDS) {
    if (field in result) delete result[field];
  }
  return result;
}

/**
 * Prepare a grave's details for a plot listing: Staff/Admin receive decrypted
 * plaintext; everyone else gets the record with sensitive fields stripped. A
 * failed decryption never falls back to raw ciphertext.
 */
export function exposeGraveDetails(grave, canSeeSensitive) {
  if (!grave || !grave.details) return grave;
  if (!canSeeSensitive) {
    return { ...grave, details: stripSensitiveDetail(grave.details) };
  }
  try {
    return { ...grave, details: decryptGraveDetail(grave.details) };
  } catch {
    return { ...grave, details: stripSensitiveDetail(grave.details) };
  }
}

/** Apply `exposeGraveDetails` to every grave of a plot. */
export function exposePlot(plot, canSeeSensitive) {
  return { ...plot, graves: (plot.graves || []).map((g) => exposeGraveDetails(g, canSeeSensitive)) };
}

/** What the public map may load for every pinned plot: layout and which tiers are taken, no grave records. */
export const PUBLIC_LAYOUT_SELECT = {
  id: true,
  plotNumber: true,
  status: true,
  totalTiers: true,
  gpsLat: true,
  gpsLng: true,
  locationDetail: { select: { subsection: true } },
  graves: { select: { tier: true } },
};

/**
 * One plot for the public map: position, status and occupied tier numbers
 * only. Graves are reduced to `{ tier }`, so the map can colour vacant and
 * occupied tiers without exposing names or any grave detail.
 */
export function publicLayoutPlot(plot) {
  return {
    id: plot.id,
    plotNumber: plot.plotNumber,
    status: plot.status,
    totalTiers: plot.totalTiers,
    gpsLat: plot.gpsLat == null ? null : Number(plot.gpsLat),
    gpsLng: plot.gpsLng == null ? null : Number(plot.gpsLng),
    locationDetail: { subsection: plot.locationDetail?.subsection ?? null },
    graves: (plot.graves || []).map((g) => ({ tier: Number(g.tier) || 1 })),
  };
}
