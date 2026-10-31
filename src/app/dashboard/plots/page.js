"use client";

import { blockFullLabel } from "@/lib/cemetery-layout";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { MapPin, CheckCircle, Archive, Lock, Wrench, Plus, Edit2, Trash2, Crosshair, Search } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useBodyScrollLock } from "../../../lib/use-body-scroll-lock";

export default function PlotsPage() {
  const { data: session } = useSession();
  // Plot layout mutations are Admin-only (PERMISSIONS.layout); Staff view only.
  const isAdmin = session?.user?.role === "Admin";
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [plots, setPlots] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Modal state — plot DATA only (number, section, status). GPS is pinned on the Map page.
  const [isModalOpen, setIsModalOpen] = useState(false);
  useBodyScrollLock(isModalOpen);
  const [isEditing, setIsEditing] = useState(false);
  const [currentPlot, setCurrentPlot] = useState({ id: null, plotNumber: "", locationDetailId: "", status: "available" });
  const [saving, setSaving] = useState(false);

  const fetchPlots = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "1000" });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/plots?${params}`);
      const data = await res.json();
      setPlots(data.plots || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch("/api/locations");
      const data = await res.json();
      setLocations(data || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => Promise.all([fetchPlots(), fetchLocations()]));
  }, [fetchPlots, fetchLocations]);

  function handleOpenModal(plot = null) {
    if (plot) {
      setIsEditing(true);
      setCurrentPlot({
        id: plot.id,
        plotNumber: plot.plotNumber,
        locationDetailId: plot.locationDetailId,
        status: plot.status,
        graveCount: plot.graves?.length ?? 0,
      });
    } else {
      setIsEditing(false);
      setCurrentPlot({ id: null, plotNumber: "", locationDetailId: "", status: "available" });
    }
    setIsModalOpen(true);
  }

  async function handleSavePlot(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const url = isEditing ? `/api/plots/${currentPlot.id}` : "/api/plots";
      const method = isEditing ? "PUT" : "POST";
      // GPS is intentionally NOT sent here — it is pinned on the Map page.
      // Omitting gpsLat/gpsLng on edit leaves any existing coordinates intact.
      const payload = {
        plotNumber: currentPlot.plotNumber,
        locationDetailId: parseInt(currentPlot.locationDetailId),
      };
      if (isEditing) payload.status = currentPlot.status;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setIsModalOpen(false);
        toast.success(isEditing ? "Plot updated" : "Plot created");
        fetchPlots();
      } else if (res.status === 409) {
        // The server says exactly why (duplicate number, plot has records, ...).
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error?.message || data?.error || "This change conflicts with an existing record.");
      } else if (res.status === 401 || res.status === 403) {
        toast.error("You don't have permission to manage plots.");
      } else {
        toast.error("Failed to save plot.");
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred");
    }
    setSaving(false);
  }

  async function handleDeletePlot(plot) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/plots/${plot.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`Plot ${plot.plotNumber} deleted`);
        fetchPlots();
      } else {
        toast.error("Failed to delete the plot. It may have grave records attached.");
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  const statusCounts = {
    available: plots.filter((p) => p.status === "available").length,
    occupied: plots.filter((p) => p.status === "occupied").length,
    reserved: plots.filter((p) => p.status === "reserved").length,
    maintenance: plots.filter((p) => p.status === "maintenance").length,
  };

  const unpinnedCount = plots.filter((p) => p.gpsLat == null || p.gpsLng == null).length;

  const filteredPlots = plots.filter((p) => {
    const matchesSearch = !searchQuery || 
      (p.plotNumber || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.locationDetail?.location?.name || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = !statusFilter || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const sortedPlots = [...filteredPlots].sort((a, b) => {
    const dateA = new Date(a.createdAt || 0).getTime();
    const dateB = new Date(b.createdAt || 0).getTime();
    return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
  });

  const totalPages = Math.ceil(sortedPlots.length / pageSize);
  const paginatedPlots = sortedPlots.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Plot Management</h1>
          <p className="page-subtitle">Manage plot details here — pin each plot&apos;s GPS location on the Map page</p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => handleOpenModal()}>
            <Plus size={18} /> Add Plot
          </button>
        )}
      </div>

      {unpinnedCount > 0 && (
        <div className="alert alert-info flex items-center gap-sm" style={{ marginBottom: "var(--space-md)" }}>
          <Crosshair size={16} />
          <span className="text-sm">
            {unpinnedCount} plot{unpinnedCount > 1 ? "s have" : " has"} no GPS location yet.
          </span>
          <Link href="/dashboard/map" className="text-sm" style={{ marginLeft: "auto", color: "var(--primary)" }}>
            Pin locations on the map →
          </Link>
        </div>
      )}

      {/* Status Overview */}
      <div className="grid grid-4" style={{ marginBottom: "var(--space-xl)" }}>
        {[
          { label: "Available", count: statusCounts.available, icon: <CheckCircle size={28} style={{ color: "var(--primary-light)" }} /> },
          { label: "Occupied", count: statusCounts.occupied, icon: <Archive size={28} style={{ color: "var(--danger)" }} /> },
          { label: "Reserved", count: statusCounts.reserved, icon: <Lock size={28} style={{ color: "var(--warning)" }} /> },
          { label: "Maintenance", count: statusCounts.maintenance, icon: <Wrench size={28} style={{ color: "var(--text-secondary)" }} /> },
        ].map((s) => (
          <button
            key={s.label}
            className="stat-card"
            onClick={() => {
              setStatusFilter(statusFilter === s.label.toLowerCase() ? "" : s.label.toLowerCase());
              setCurrentPage(1);
            }}
            style={{
              cursor: "pointer",
              textAlign: "left",
              border: statusFilter === s.label.toLowerCase() ? "1px solid var(--primary)" : undefined,
              display: 'flex', 
              flexDirection: 'column', 
              gap: '12px',
            }}
          >
            <div className="flex items-center justify-between" style={{ width: '100%' }}>
              <div className="stat-label" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{s.label} Plots</div>
              {s.icon}
            </div>
            <div className="stat-value" style={{ marginBottom: 0, fontSize: '1.875rem' }}>{s.count}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-sm items-center mb-lg" style={{ flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 250 }}>
          <Search size={16} className="text-muted" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input
            type="text"
            className="form-input"
            style={{ paddingLeft: 36 }}
            placeholder="Search plots by number or location..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
          />
        </div>
        
        <select 
          className="form-select" 
          style={{ width: 160 }}
          value={sortOrder}
          onChange={(e) => { setSortOrder(e.target.value); setCurrentPage(1); }}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>

        {(searchQuery || statusFilter) && (
          <button
            className="btn btn-ghost"
            onClick={() => { setSearchQuery(""); setStatusFilter(""); setCurrentPage(1); }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Plots Table */}
      {loading ? (
        <div className="flex justify-center" style={{ padding: "var(--space-3xl)" }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : filteredPlots.length > 0 ? (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Plot Number</th>
                <th>Location</th>
                <th>Section</th>
                <th>Status</th>
                <th>Occupant</th>
                <th>GPS</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {paginatedPlots.map((plot) => {
                const pinned = plot.gpsLat != null && plot.gpsLng != null;
                return (
                  <tr key={plot.id}>
                    <td style={{ fontWeight: 600 }}>{plot.plotNumber}</td>
                    <td>{plot.locationDetail?.location?.name || "—"}</td>
                    <td>{plot.locationDetail?.subsection || "—"}</td>
                    <td>
                      <span
                        className={`badge ${
                          plot.status === "available" ? "badge-success"
                            : plot.status === "occupied" ? "badge-danger"
                            : plot.status === "reserved" ? "badge-warning"
                            : "badge-info"
                        }`}
                      >
                        {plot.status}
                      </span>
                    </td>
                    <td className="text-sm">
                      {plot.graves?.length > 0 ? plot.graves.map((g) => g.deceasedName).join(", ") : "—"}
                    </td>
                    <td className="text-xs">
                      {pinned ? (
                        <Link
                          href={`/dashboard/map?plot=${plot.id}`}
                          className="text-muted"
                          title="Adjust location on map"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {Number(plot.gpsLat).toFixed(6)}, {Number(plot.gpsLng).toFixed(6)}
                        </Link>
                      ) : (
                        <Link
                          href={`/dashboard/map?plot=${plot.id}`}
                          className="inline-flex items-center gap-xs"
                          style={{ color: "var(--primary)" }}
                          title="Set location on map"
                        >
                          <Crosshair size={13} /> Set on map
                        </Link>
                      )}
                    </td>
                    {isAdmin && (
                      <td>
                        <div className="flex action-buttons">
                          <button
                            className="action-btn"
                            onClick={() => handleOpenModal(plot)}
                            title="Edit details"
                            aria-label={`Edit plot ${plot.plotNumber}`}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            className="action-btn danger-icon"
                            onClick={() => setPendingDelete(plot)}
                            title="Delete"
                            aria-label={`Delete plot ${plot.plotNumber}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="table-footer">
            <span className="text-sm text-muted">
              Showing {filteredPlots.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredPlots.length)} of {filteredPlots.length} records
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
                disabled={currentPage >= totalPages || totalPages === 0} 
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
          <h3 className="empty-state-title">No Plots Found</h3>
          <p className="empty-state-text">No plots match your current filters.</p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this plot?"
        description={
          pendingDelete
            ? `Plot ${pendingDelete.plotNumber} will be permanently removed. This cannot be undone, and the plot cannot be deleted if a grave record is still attached to it.`
            : ""
        }
        confirmLabel="Delete plot"
        busy={deleting}
        onConfirm={() => handleDeletePlot(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Modal Overlay — plot DATA only */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center" style={{ marginBottom: "0.85rem" }}>
              <h2 style={{ fontSize: "1.2rem", margin: 0 }}>{isEditing ? "Edit Plot" : "Add Plot"}</h2>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSavePlot} className="flex flex-col gap-md">
              <div className="form-group">
                <label className="form-label">Location / Section</label>
                <select
                  className="form-select"
                  value={currentPlot.locationDetailId}
                  onChange={(e) => setCurrentPlot({ ...currentPlot, locationDetailId: e.target.value })}
                  required
                >
                  <option value="">Select a section...</option>
                  {locations.map((loc) => (
                    <optgroup key={loc.id} label={loc.name}>
                      {loc.details?.map((det) => (
                        <option key={det.id} value={det.id}>
                          {blockFullLabel(det.subsection)} (Capacity: {det.capacity})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Plot Number</label>
                <input
                  type="text"
                  className="form-input"
                  value={currentPlot.plotNumber}
                  onChange={(e) => setCurrentPlot({ ...currentPlot, plotNumber: e.target.value })}
                  placeholder="e.g. A1-001"
                  required
                />
              </div>

              {isEditing && (
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select
                    className="form-select"
                    value={currentPlot.status}
                    onChange={(e) => setCurrentPlot({ ...currentPlot, status: e.target.value })}
                  >
                    <option value="available" disabled={currentPlot.graveCount > 0}>Available</option>
                    <option value="occupied">Occupied</option>
                    <option value="reserved" disabled={currentPlot.graveCount > 0}>Reserved</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                  {currentPlot.graveCount > 0 && (
                    <p className="text-sm text-muted" style={{ marginTop: 4 }}>
                      This plot has {currentPlot.graveCount} grave record{currentPlot.graveCount === 1 ? "" : "s"}, so it
                      can be Occupied or under Maintenance. Its records are kept either way.
                    </p>
                  )}
                </div>
              )}

              <div className="alert alert-info flex items-center gap-xs" style={{ marginTop: "var(--space-xs)" }}>
                <Crosshair size={15} />
                <span className="text-sm">
                  {isEditing
                    ? "GPS location is managed on the Map page."
                    : "After saving, pin this plot's GPS location on the Map page."}
                </span>
              </div>

              <div className="flex gap-sm" style={{ marginTop: "0.75rem" }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setIsModalOpen(false)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={saving}>
                  {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Plot"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
