"use client";

import { PHOTO_ACCEPT, preparePhoto } from "@/lib/prepare-photo";
import { blockFullLabel } from "@/lib/cemetery-layout";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import { Search, Archive, Pencil, Trash2, Camera, Upload } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useBodyScrollLock } from "../../../lib/use-body-scroll-lock";
import { useIsClient } from "@/lib/use-is-client";
import PlotPickerModal from "@/components/plot-picker/PlotPickerModal";
import { canAddGrave, describeGravePosition, getGravePhoto, tierAvailability } from "@/lib/plot-format";

const EMPTY_FORM = {
  deceasedName: "",
  plotId: "",
  tier: 1,
  dateOfBirth: "",
  dateOfDeath: "",
  burialDate: "",
  causeOfDeath: "",
  contactPerson: "",
  contactPhone: "",
  notes: "",
  photo: "",
};

export default function GravesPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "Admin";
  const [graves, setGraves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const pageSize = 10;
  const [showModal, setShowModal] = useState(false);
  const isClient = useIsClient();
  useBodyScrollLock(showModal);
  const [editingId, setEditingId] = useState(null);
  const [editingGrave, setEditingGrave] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPlotPicker, setShowPlotPicker] = useState(false);
  const [plots, setPlots] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [verificationFilter, setVerificationFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [initialPhoto, setInitialPhoto] = useState("");

  const fetchGraves = useCallback(async () => {
    // Skip default fetch if we are actively viewing search results
    if (searchQuery.trim()) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (verificationFilter) params.set("verificationStatus", verificationFilter);
      params.set("page", currentPage);
      params.set("limit", pageSize);
      const res = await fetch(`/api/graves?${params}`);
      const data = await res.json();
      setGraves(data.graves || []);
      setTotalPages(data.pagination?.totalPages || 0);
      setTotalRecords(data.pagination?.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, verificationFilter, currentPage, searchQuery]);

  const fetchPlots = useCallback(async () => {
    try {
      // All plots: a partly filled crypt is "occupied" but still has vacant tiers.
      const res = await fetch("/api/plots?limit=1000", { cache: "no-store" });
      const data = await res.json();
      setPlots(data.plots || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => Promise.all([fetchGraves(), fetchPlots()]));
  }, [fetchGraves, fetchPlots]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!searchQuery.trim()) {
        setSearchResults(null);
        return;
      }
      setLoading(true);
      fetch(`/api/graves?q=${encodeURIComponent(searchQuery)}`)
        .then(res => res.json())
        .then(data => {
          setSearchResults(data);
          setCurrentPage(1);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(editingId ? `/api/graves/${editingId}` : "/api/graves", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deceasedName: form.deceasedName,
          plotId: parseInt(form.plotId),
          tier: form.tier ? parseInt(form.tier) : 1,
          burialDate: form.burialDate || null,
          birthDate: form.dateOfBirth || null,
          deathDate: form.dateOfDeath || null,
          causeOfDeath: form.causeOfDeath || null,
          contactPerson: form.contactPerson || null,
          contactPhone: form.contactPhone || null,
          notes: form.notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error?.message || err.error || `Failed to ${editingId ? "update" : "create"} record`);
        setSubmitting(false);
        return;
      }

      const resData = await res.json();
      const targetGraveId = editingId || resData.id || resData.grave?.id;

      if (targetGraveId && photoFile) {
        const formData = new FormData();
        formData.append("file", photoFile);
        try {
          const photoRes = await fetch(`/api/graves/${targetGraveId}/photo`, {
            method: "POST",
            body: formData,
          });
          if (!photoRes.ok) {
            const photoErr = await photoRes.json();
            toast.error(photoErr.error || "Failed to upload photo file");
          }
        } catch {
          toast.error("Failed to upload photo file");
        }
      } else if (targetGraveId && form.photo !== initialPhoto) {
        try {
          await fetch(`/api/graves/${targetGraveId}/photo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photoUrl: form.photo || "reset" }),
          });
        } catch {
          // ignore
        }
      }

      setShowModal(false);
      setEditingId(null);
      setEditingGrave(null);
      setForm(EMPTY_FORM);
      setPhotoFile(null);
      setPhotoPreview(null);
      await Promise.all([fetchGraves(), fetchPlots()]);
      toast.success(editingId ? "Record updated" : "Record created");
    } catch {
      toast.error("An error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  // Deep link from the map: /dashboard/graves?plot=<plot number or id>&tier=<n>
  // opens the add form with that plot and tier chosen.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || !isAdmin || plots.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const target = params.get("plot");
    if (!target) return;
    deepLinkHandled.current = true;

    const plot = plots.find(
      (p) => String(p.id) === target || p.plotNumber?.toLowerCase() === target.toLowerCase()
    );
    window.history.replaceState(null, "", window.location.pathname);
    if (!plot) {
      toast.error(`Plot "${target}" was not found`);
      return;
    }
    const tiers = tierAvailability(plot);
    const wanted = Number(params.get("tier"));
    const pick =
      tiers.find((t) => t.tier === wanted && !t.occupant) || tiers.find((t) => !t.occupant);
    if (!pick) {
      toast.error(`Every tier of ${plot.plotNumber} already has a record`);
      return;
    }
    // Deferred so state is not set synchronously inside the effect.
    queueMicrotask(() => {
      setEditingId(null);
      setEditingGrave(null);
      setForm({ ...EMPTY_FORM, plotId: String(plot.id), tier: pick.tier });
      setInitialPhoto("");
      setPhotoFile(null);
      setPhotoPreview(null);
      setShowModal(true);
    });
  }, [plots, isAdmin]);

  function openCreate() {
    setEditingId(null);
    setEditingGrave(null);
    setForm(EMPTY_FORM);
    setInitialPhoto("");
    setPhotoFile(null);
    setPhotoPreview(null);
    setShowModal(true);
  }

  function openEdit(grave) {
    setEditingId(grave.id);
    setEditingGrave(grave);
    const photo = getGravePhoto(grave) || "";
    const textNotes = grave.details?.notes || "";

    const formatDateForInput = (val) => {
      if (!val) return "";
      try {
        const d = new Date(val);
        if (!Number.isNaN(d.getTime())) {
          return d.toISOString().slice(0, 10);
        }
      } catch {
        // fallback
      }
      return String(val).slice(0, 10);
    };

    setForm({
      deceasedName: grave.deceasedName || "",
      plotId: String(grave.plotId || ""),
      tier: grave.tier || 1,
      dateOfBirth: formatDateForInput(grave.birthDate),
      dateOfDeath: formatDateForInput(grave.deathDate),
      burialDate: formatDateForInput(grave.burialDate),
      causeOfDeath: grave.details?.causeOfDeath || "",
      contactPerson: grave.details?.contactPerson || "",
      contactPhone: grave.details?.contactPhone || "",
      notes: textNotes,
      photo: photo,
    });
    setInitialPhoto(photo);
    setPhotoFile(null);
    setPhotoPreview(photo || null);
    setShowModal(true);
  }

  async function deleteGrave(grave) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/graves/${grave.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || "Failed to delete record");
      toast.success(`Record for ${grave.deceasedName} deleted`);
      await Promise.all([fetchGraves(), fetchPlots()]);
    } catch (err) {
      toast.error(err.message || "Failed to delete record");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  let displayGraves = graves;
  let currentTotalPages = totalPages;
  let currentTotalRecords = totalRecords;
  let currentStart = (currentPage - 1) * pageSize + 1;
  let currentEnd = Math.min(currentPage * pageSize, totalRecords);

  if (searchResults) {
    const allSearch = [...(searchResults.exact || []), ...(searchResults.suggestions || [])];
    currentTotalRecords = allSearch.length;
    currentTotalPages = Math.ceil(currentTotalRecords / pageSize);
    displayGraves = allSearch.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    currentStart = currentTotalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    currentEnd = Math.min(currentPage * pageSize, currentTotalRecords);
  } else {
    currentStart = totalRecords === 0 ? 0 : currentStart;
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Grave Records</h1>
          <p className="page-subtitle">Manage and search burial records</p>
        </div>
        {isAdmin && (
          <button 
            className="btn btn-primary-minimal" 
            onClick={openCreate} 
            id="add-grave-btn"
          >
            + Add Grave Record
          </button>
        )}
      </div>

      {/* Search & Filters */}
      <div className="flex gap-sm items-center mb-lg" style={{ flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 250 }}>
          <Search size={16} className="text-muted" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input
            type="text"
            className="form-input"
            style={{ paddingLeft: 36 }}
            placeholder="Search by name, ID, or year..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            id="grave-search-input"
          />
        </div>
        <select
          className="form-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ width: 160 }}
          id="grave-status-filter"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <select
          className="form-select"
          value={verificationFilter}
          onChange={(e) => setVerificationFilter(e.target.value)}
          style={{ width: 175 }}
          id="grave-verification-filter"
        >
          <option value="">All Verification</option>
          <option value="pending">Pending</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
        {searchResults && (
          <button
            className="btn btn-ghost"
            onClick={() => setSearchQuery("")}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Phonetic match notice */}
      {searchResults?.suggestions?.length > 0 && searchResults?.exact?.length === 0 && (
        <div className="alert alert-info flex items-center gap-sm" style={{ marginBottom: "var(--space-md)" }}>
          <Search size={16} /> No exact match found. Showing closest phonetic suggestions:
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="flex justify-center" style={{ padding: "var(--space-3xl)" }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : displayGraves.length > 0 ? (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Deceased Name</th>
                <th>Plot</th>
                <th>Location</th>
                <th>Burial Date</th>
                <th>Status</th>
                {isAdmin && <th>Actions</th>}
                {searchResults?.suggestions?.length > 0 && <th>Match</th>}
              </tr>
            </thead>
            <tbody>
              {displayGraves.map((grave) => {
                const gravePhoto = getGravePhoto(grave);
                return (
                  <tr key={grave.id}>
                    <td>
                      <div className="flex items-center gap-sm">
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            overflow: "hidden",
                            backgroundColor: "var(--bg-secondary, #f1f5f9)",
                            border: "1px solid var(--border-color, #e2e8f0)",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {gravePhoto ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={gravePhoto}
                              alt={grave.deceasedName}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.src = "/images/memorial_headstone.jpg";
                              }}
                            />
                          ) : (
                            <Camera size={16} className="text-muted" />
                          )}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{grave.deceasedName}</div>
                          {grave.details?.contactPerson && (
                            <div className="text-xs text-muted">
                              Contact: {grave.details.contactPerson}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                        {grave.plot?.plotNumber || "—"}
                      </span>
                      {describeGravePosition(grave)?.tier && (
                        <div className="text-sm text-muted">
                          Column {describeGravePosition(grave).column} · {describeGravePosition(grave).tier}
                        </div>
                      )}
                    </td>
                    <td className="text-sm">
                      {grave.plot?.locationDetail?.location?.name || "—"}
                      {grave.plot?.locationDetail?.subsection &&
                        ` / ${blockFullLabel(grave.plot.locationDetail.subsection)}`}
                    </td>
                    <td>
                      {grave.burialDate
                        ? new Date(grave.burialDate).toLocaleDateString()
                        : "—"}
                    </td>
                    <td>
                      {grave.status === "archived" ? (
                        <span className="badge badge-muted">Archived</span>
                      ) : (
                        <span
                          className={`badge ${
                            grave.verificationStatus === "verified"
                              ? "badge-success"
                              : grave.verificationStatus === "rejected"
                              ? "badge-danger"
                              : "badge-warning"
                          }`}
                        >
                          {grave.verificationStatus || "pending"}
                        </span>
                      )}
                    </td>
                    {isAdmin && (
                      <td>
                        <div className="flex action-buttons" style={{ alignItems: "center", gap: "0.35rem" }}>
                          <button className="action-btn" onClick={() => openEdit(grave)} title={`Edit ${grave.deceasedName}`} aria-label={`Edit ${grave.deceasedName}`}>
                            <Pencil size={16} />
                          </button>
                          <button className="action-btn danger-icon" onClick={() => setPendingDelete(grave)} title={`Delete ${grave.deceasedName}`} aria-label={`Delete ${grave.deceasedName}`}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  {grave.score !== undefined && (
                    <td>
                      <span className="badge badge-info">
                        {Math.round(grave.score * 100)}%
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
            </tbody>
          </table>
          
          <div className="table-footer">
            <span className="text-sm text-muted">
              Showing {currentStart} to {currentEnd} of {currentTotalRecords} records
            </span>
            <div className="flex gap-sm">
              <button 
                className="btn btn-secondary btn-sm" 
                disabled={currentPage === 1} 
                onClick={() => setCurrentPage(p => p - 1)}
              >
                Previous
              </button>
              <button 
                className="btn btn-secondary btn-sm" 
                disabled={currentPage >= currentTotalPages || currentTotalPages === 0} 
                onClick={() => setCurrentPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Archive size={48} />
          </div>
          <h3 className="empty-state-title">No Records Found</h3>
          <p className="empty-state-text">
            {searchQuery
              ? "No graves match your search. Try different keywords."
              : "Add your first grave record to get started."}
          </p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Permanently delete this record?"
        description={
          pendingDelete
            ? `The burial record for ${pendingDelete.deceasedName} will be permanently deleted and its plot released. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete record"
        busy={deleting}
        onConfirm={() => deleteGrave(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Add/Edit Grave Modal */}
      {showModal && isAdmin && isClient && createPortal(
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{editingId ? "Edit Grave Record" : "Add Grave Record"}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                ✕
              </button>
            </div>
            <form className="modal-body" onSubmit={handleSubmit}>
              <div className="grave-modal-layout">
                {/* Left Column: Grave & Personal Details */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                  <div className="form-group">
                    <label className="form-label">Deceased Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.deceasedName}
                      onChange={(e) => setForm({ ...form, deceasedName: e.target.value })}
                      required
                      id="grave-form-name"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Plot *</label>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ width: "100%", justifyContent: "center", marginBottom: 6 }}
                      onClick={() => setShowPlotPicker(true)}
                      id="grave-form-pick-on-map"
                    >
                      {(() => {
                        const chosen = plots.find((p) => String(p.id) === String(form.plotId));
                        if (!chosen) return "Pick the plot on the map";
                        const multi = (Number(chosen.totalTiers) || 1) > 1;
                        return `${chosen.plotNumber}${multi ? ` · Tier ${form.tier || 1}` : ""} — change on map`;
                      })()}
                    </button>
                    {showPlotPicker && (
                      <PlotPickerModal
                        plots={plots}
                        selectedPlotId={form.plotId || null}
                        selectedTier={form.tier || null}
                        ignoreGraveId={editingId}
                        onSelect={({ plotId, tier }) => {
                          setForm((f) => ({ ...f, plotId: String(plotId), tier }));
                          setShowPlotPicker(false);
                        }}
                        onClose={() => setShowPlotPicker(false)}
                      />
                    )}
                    <select
                      className="form-select"
                      value={form.plotId}
                      onChange={(e) => {
                        const plot = plots.find((p) => String(p.id) === e.target.value);
                        const firstVacant = tierAvailability(plot, editingId).find((t) => !t.occupant);
                        setForm({ ...form, plotId: e.target.value, tier: firstVacant?.tier ?? 1 });
                      }}
                      required
                      id="grave-form-plot"
                    >
                      <option value="">Select plot...</option>
                      {editingId && form.plotId && !plots.some((p) => String(p.id) === form.plotId) && (() => {
                        const current = (editingGrave || displayGraves.find((grave) => grave.id === editingId))?.plot;
                        return <option value={form.plotId}>{current?.plotNumber || `Plot ${form.plotId}`} — current assignment</option>;
                      })()}
                      {(() => {
                        // Offer plots that can take a record, grouped by location and section.
                        const groups = new Map();
                        for (const p of plots) {
                          if (!(canAddGrave(p) || (editingId && String(p.id) === form.plotId))) continue;
                          const label =
                            [p.locationDetail?.location?.name, p.locationDetail?.subsection]
                              .filter(Boolean)
                              .join(" · ") || "Other";
                          if (!groups.has(label)) groups.set(label, []);
                          groups.get(label).push(p);
                        }
                        return [...groups.entries()].map(([label, list]) => (
                          <optgroup key={label} label={label}>
                            {list.map((p) => {
                              const tiers = tierAvailability(p, editingId);
                              const vacant = tiers.filter((t) => !t.occupant).length;
                              return (
                                <option key={p.id} value={p.id}>
                                  {p.plotNumber}
                                  {tiers.length > 1 ? ` (${vacant} of ${tiers.length} tiers vacant)` : ""}
                                </option>
                              );
                            })}
                          </optgroup>
                        ));
                      })()}
                    </select>
                  </div>

                  {(() => {
                    const selectedPlot = plots.find((p) => String(p.id) === String(form.plotId));
                    const tiers = tierAvailability(selectedPlot, editingId);
                    if (tiers.length <= 1) return null;
                    return (
                      <div className="form-group">
                        <label className="form-label">Crypt Niche Tier *</label>
                        <select
                          className="form-select"
                          value={form.tier || 1}
                          onChange={(e) => setForm({ ...form, tier: parseInt(e.target.value, 10) })}
                          required
                          id="grave-form-tier"
                        >
                          {tiers.map((t) => (
                            <option key={t.tier} value={t.tier} disabled={Boolean(t.occupant)}>
                              {t.label}
                              {t.occupant ? ` — occupied by ${t.occupant.deceasedName}` : " — vacant"}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}

                  {/* Life & Interred Dates */}
                  <div className="grid grid-2">
                    <div className="form-group">
                      <label className="form-label">Date of Birth</label>
                      <input
                        type="date"
                        className="form-input"
                        value={form.dateOfBirth}
                        onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                        id="grave-form-dob"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Date of Death</label>
                      <input
                        type="date"
                        className="form-input"
                        value={form.dateOfDeath}
                        onChange={(e) => setForm({ ...form, dateOfDeath: e.target.value })}
                        id="grave-form-dod"
                      />
                    </div>
                  </div>

                  <div className="grid grid-2">
                    <div className="form-group">
                      <label className="form-label">Burial Date</label>
                      <input
                        type="date"
                        className="form-input"
                        value={form.burialDate}
                        onChange={(e) => setForm({ ...form, burialDate: e.target.value })}
                        id="grave-form-date"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Cause of Death</label>
                      <input
                        type="text"
                        className="form-input"
                        value={form.causeOfDeath}
                        onChange={(e) => setForm({ ...form, causeOfDeath: e.target.value })}
                        placeholder="e.g. Natural Causes, Cardiac Arrest"
                      />
                    </div>
                  </div>

                  <div className="grid grid-2">
                    <div className="form-group">
                      <label className="form-label">Contact Person</label>
                      <input
                        type="text"
                        className="form-input"
                        value={form.contactPerson}
                        onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                        placeholder="Family member / next of kin"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Contact Phone</label>
                      <input
                        type="text"
                        className="form-input"
                        value={form.contactPhone}
                        onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                        placeholder="e.g. +63 917 555 0192"
                      />
                    </div>
                  </div>
                </div>

                {/* Right Column: Photo & Notes */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                  {/* Profile Photo */}
                  <div className="form-group" style={{ marginBottom: "0.2rem" }}>
                    <label className="form-label" style={{ marginBottom: "0.3rem" }}>Profile / Headstone Photo</label>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "stretch",
                        borderRadius: "var(--radius-md, 8px)",
                        border: "1px solid var(--border-default, #e2e8f0)",
                        background: "var(--bg-glass, rgba(241, 245, 249, 0.45))",
                        minHeight: "96px",
                        overflow: "hidden",
                      }}
                    >
                      {/* Photo Preview Frame - 100% height length of the card */}
                      <div
                        style={{
                          position: "relative",
                          width: "140px",
                          minHeight: "92px",
                          height: "100%",
                          borderRight: "1px solid var(--border-default, #e2e8f0)",
                          overflow: "hidden",
                          backgroundColor: "var(--bg-surface, #ffffff)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {photoPreview ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={photoPreview}
                            alt="Grave preview (16:9 landscape)"
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = "/images/memorial_headstone.jpg";
                            }}
                          />
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem", color: "var(--text-muted)", padding: "0.5rem" }}>
                            <Camera size={24} style={{ opacity: 0.55 }} />
                            <span style={{ fontSize: "0.68rem", fontWeight: 600, opacity: 0.75 }}>16:9 Landscape</span>
                          </div>
                        )}
                      </div>

                      {/* Actions & Format Hint */}
                      <div style={{ flex: 1, minWidth: 0, padding: "0.65rem 0.8rem", display: "flex", flexDirection: "column", justifyContent: "center", gap: "0.45rem" }}>
                        {/* Upload and Delete in the same row */}
                        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "nowrap" }}>
                          <label
                            className="btn btn-secondary btn-sm"
                            style={{
                              cursor: "pointer",
                              margin: 0,
                              padding: "0.38rem 0.7rem",
                              fontSize: "0.78rem",
                              fontWeight: 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.35rem",
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                            }}
                          >
                            <Upload size={13} />
                            <span>Upload Photo</span>
                            <input
                              type="file"
                              accept={PHOTO_ACCEPT}
                              style={{ display: "none" }}
                              onChange={async (e) => {
                                const picked = e.target.files?.[0];
                                e.target.value = "";
                                if (!picked) return;
                                // Large phone photos and HEIC are shrunk to a JPEG first.
                                const ready = await preparePhoto(picked);
                                if (!ready.ok) {
                                  toast.error(ready.error);
                                  return;
                                }
                                const file = ready.file;
                                setPhotoFile(file);
                                const reader = new FileReader();
                                reader.onload = (evt) => {
                                  setPhotoPreview(evt.target.result);
                                };
                                reader.readAsDataURL(file);
                              }}
                            />
                          </label>

                          {(photoPreview || form.photo) && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm text-danger"
                              style={{
                                padding: "0.38rem 0.65rem",
                                fontSize: "0.78rem",
                                fontWeight: 500,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.3rem",
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                              }}
                              onClick={() => {
                                setPhotoFile(null);
                                setPhotoPreview(null);
                                setForm((prev) => ({ ...prev, photo: "" }));
                              }}
                            >
                              <Trash2 size={13} />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>

                        <span className="text-xs text-muted" style={{ fontSize: "0.72rem", lineHeight: 1.3 }}>
                          JPG, PNG, WebP (Max 5MB) • Best in landscape
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="form-group" style={{ flex: 1, display: "flex", flexDirection: "column", marginBottom: 0 }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: "0.25rem" }}>
                      <label className="form-label" style={{ margin: 0 }}>Notes</label>
                      <span className="text-xs text-muted" style={{ fontWeight: 400, textTransform: "none", fontSize: "0.72rem" }}>
                        Remarks or family instructions
                      </span>
                    </div>
                    <textarea
                      className="form-textarea"
                      style={{
                        flex: 1,
                        minHeight: "105px",
                        height: "100%",
                        resize: "vertical",
                        fontSize: "0.85rem",
                        lineHeight: 1.45,
                      }}
                      placeholder="Enter memorial remarks, family instructions, or special notes..."
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Modal Footer with Cancel & Save fully in viewport */}
              <div
                className="modal-footer"
                style={{
                  marginTop: "0.85rem",
                  paddingTop: "0.75rem",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.75rem",
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ minWidth: "110px", justifyContent: "center" }}
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ minWidth: "150px", justifyContent: "center" }}
                  disabled={submitting}
                  id="grave-form-submit"
                >
                  {submitting ? "Saving..." : editingId ? "Save Changes" : "Save Grave Record"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
