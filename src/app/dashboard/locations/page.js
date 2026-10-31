"use client";

import { blockFullLabel, blockTypeName } from "@/lib/cemetery-layout";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { MapPin, Map, Navigation, Pencil, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useBodyScrollLock } from "../../../lib/use-body-scroll-lock";

export default function LocationsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const isAdmin = session?.user?.role === "Admin";
  const [pendingToggle, setPendingToggle] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  useBodyScrollLock(showModal);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    gpsLat: "",
    gpsLng: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchLocations = useCallback(async () => {
    if (sessionStatus === "loading") return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(isAdmin ? "/api/locations?includeInactive=true" : "/api/locations");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || "Failed to load locations");
      setLocations(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, sessionStatus]);

  useEffect(() => {
    void Promise.resolve().then(fetchLocations);
  }, [fetchLocations]);

  function openCreate() {
    setEditingId(null);
    setForm({ name: "", description: "", gpsLat: "", gpsLng: "" });
    setShowModal(true);
  }

  function openEdit(location) {
    setEditingId(location.id);
    setForm({
      name: location.name || "",
      description: location.description || "",
      gpsLat: location.gpsLat ?? "",
      gpsLng: location.gpsLng ?? "",
    });
    setShowModal(true);
  }

  async function toggleLocation(location) {
    const action = location.isActive ? "deactivate" : "reactivate";
    setToggling(true);
    try {
      const res = await fetch(`/api/locations/${location.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !location.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || `Failed to ${action} location`);
      toast.success(`${location.name} ${location.isActive ? "deactivated" : "reactivated"}`);
      await fetchLocations();
    } catch (err) {
      toast.error(err.message || `Failed to ${action} location`);
    } finally {
      setToggling(false);
      setPendingToggle(null);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(editingId ? `/api/locations/${editingId}` : "/api/locations", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          gpsLat: form.gpsLat ? parseFloat(form.gpsLat) : null,
          gpsLng: form.gpsLng ? parseFloat(form.gpsLng) : null,
        }),
      });

      if (res.ok) {
        setShowModal(false);
        setEditingId(null);
        setForm({ name: "", description: "", gpsLat: "", gpsLng: "" });
        await fetchLocations();
        toast.success(editingId ? "Location updated" : "Location created");
      } else {
        const err = await res.json();
        toast.error(err.error?.message || err.error || `Failed to ${editingId ? "update" : "create"} location`);
      }
    } catch {
      toast.error("An error occurred");
    }
    setSubmitting(false);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Locations</h1>
          <p className="page-subtitle">Manage cemetery zones and sections</p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={openCreate} id="add-location-btn">
            + Add Location
          </button>
        )}
      </div>

      {error ? (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: "var(--space-lg)" }}>
          {error} <button className="btn btn-ghost btn-sm" onClick={fetchLocations}>Retry</button>
        </div>
      ) : loading ? (
        <div className="flex justify-center" style={{ padding: "var(--space-3xl)" }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : locations.length > 0 ? (
        <div className="grid grid-2">
          {locations.map((loc) => {
            const totalPlots = loc.details?.reduce(
              (sum, d) => sum + (d.plots?.length || 0),
              0
            ) || 0;
            const availablePlots = loc.details?.reduce(
              (sum, d) => sum + (d.plots?.filter((p) => p.status === "available").length || 0),
              0
            ) || 0;

            return (
              <div key={loc.id} className="card flex flex-col justify-between" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: "var(--space-lg)" }}>
                  <div className="flex justify-between items-start" style={{ marginBottom: "var(--space-md)" }}>
                    <div className="flex items-center gap-md">
                      <MapPin size={36} className="text-primary" />
                      <div>
                        <div className="flex items-center gap-sm">
                          <h4 style={{ margin: 0, fontSize: "1.1rem" }}>{loc.name}</h4>
                          {!loc.isActive && <span className="badge badge-muted">Inactive</span>}
                        </div>
                        {loc.description && (
                          <p className="text-sm text-muted" style={{ margin: "4px 0 0 0" }}>
                            {loc.description}
                          </p>
                        )}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-xs">
                        <button className="action-btn" onClick={() => openEdit(loc)} title={`Edit ${loc.name}`}>
                          <Pencil size={16} />
                        </button>
                        <button 
                          className={`action-btn ${loc.isActive ? 'danger-icon' : ''}`} 
                          onClick={() => setPendingToggle(loc)} 
                          title={`${loc.isActive ? "Deactivate" : "Reactivate"} ${loc.name}`}
                        >
                          {loc.isActive ? <PowerOff size={16} /> : <Power size={16} />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Subsections */}
                  {loc.details?.length > 0 && (
                    <div style={{ marginTop: "var(--space-md)" }}>
                      <div className="text-xs text-muted" style={{ marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Subsections
                      </div>
                      <div className="flex gap-sm" style={{ flexWrap: "wrap" }}>
                        {loc.details.map((d) => (
                          <span key={d.id} style={{ 
                            fontSize: "0.75rem", 
                            padding: "4px 10px", 
                            background: "rgba(255,255,255,0.05)", 
                            border: "1px solid var(--border-default)",
                            borderRadius: "var(--radius-full)",
                            color: "var(--text-secondary)",
                            display: "inline-flex",
                            alignItems: "center"
                          }}>
                            <span style={{ fontWeight: 600, color: "var(--text-primary)", marginRight: 4 }} title={blockTypeName(d.subsection) || undefined}>{blockFullLabel(d.subsection)}</span> 
                            {d.plots?.length || 0} plots
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center" style={{ 
                  padding: "var(--space-md) var(--space-lg)", 
                  background: "rgba(0,0,0,0.15)", 
                  borderTop: "1px solid var(--border-default)" 
                }}>
                  <div className="flex gap-lg text-sm">
                    <div>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{totalPlots}</span> <span className="text-muted">Plots</span>
                    </div>
                    <div>
                      <span style={{ fontWeight: 600, color: "var(--success)" }}>{availablePlots}</span> <span className="text-muted">Available</span>
                    </div>
                  </div>
                  {loc.gpsLat && loc.gpsLng && (
                    <div className="text-xs text-muted flex items-center gap-xs">
                      <Navigation size={12} /> {Number(loc.gpsLat).toFixed(4)}, {Number(loc.gpsLng).toFixed(4)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Map size={48} />
          </div>
          <h3 className="empty-state-title">No Locations</h3>
          <p className="empty-state-text">
            Add cemetery zones and sections to organize your plots.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingToggle)}
        title={pendingToggle?.isActive ? "Deactivate this location?" : "Reactivate this location?"}
        description={
          pendingToggle
            ? `${pendingToggle.name} will be ${pendingToggle.isActive ? "hidden from new assignments" : "made available again"}. Existing sections, plots, and map references are preserved either way.`
            : ""
        }
        confirmLabel={pendingToggle?.isActive ? "Deactivate" : "Reactivate"}
        tone={pendingToggle?.isActive ? "danger" : "primary"}
        busy={toggling}
        onConfirm={() => toggleLocation(pendingToggle)}
        onCancel={() => setPendingToggle(null)}
      />

      {/* Add/Edit Location Modal */}
      {showModal && isAdmin && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{editingId ? "Edit Location" : "Add Location"}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                ✕
              </button>
            </div>
            <form className="modal-body" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Location Name *</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., Section A - North"
                  required
                  id="location-form-name"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-textarea"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional description..."
                />
              </div>
              <div className="grid grid-2">
                <div className="form-group">
                  <label className="form-label">GPS Latitude</label>
                  <input
                    type="number"
                    step="any"
                    className="form-input"
                    value={form.gpsLat}
                    onChange={(e) => setForm({ ...form, gpsLat: e.target.value })}
                    placeholder="e.g., 8.2456"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">GPS Longitude</label>
                  <input
                    type="number"
                    step="any"
                    className="form-input"
                    value={form.gpsLng}
                    onChange={(e) => setForm({ ...form, gpsLng: e.target.value })}
                    placeholder="e.g., 124.9653"
                  />
                </div>
              </div>
              <div className="flex gap-sm" style={{ marginTop: "0.75rem" }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={submitting} id="location-form-submit">
                  {submitting ? "Saving..." : editingId ? "Save Changes" : "Save Location"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
