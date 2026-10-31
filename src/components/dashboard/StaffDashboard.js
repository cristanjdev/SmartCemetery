"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck, MapPin, ClipboardList, Bell, Archive, Eye,
  ArrowRight, CheckCircle2, AlertTriangle, Layers, Clock,
  ShieldCheck, FileText, Search, Compass
} from "lucide-react";
import { PageHeader } from "./PageHeader";
import { KpiCard } from "./KpiCard";
import { LocateGraveCard } from "./LocateGraveCard";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { countPlotStatuses, timeAgo } from "../../lib/dashboard-metrics";

/**
 * Staff dashboard — verification-first workspace.
 * Redesigned with professional visual containers below KPI cards.
 */
export function StaffDashboard({ userName }) {
  const [incomplete, setIncomplete] = useState([]);
  const [plots, setPlots] = useState([]);
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (url) => {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      return res.json();
    };

    Promise.all([
      load("/api/graves/incomplete"),
      load("/api/plots"),
      load("/api/requests"),
      load("/api/notifications"),
    ])
      .then(([incompleteData, plotData, requestData, notificationData]) => {
        const rows = Array.isArray(incompleteData) ? incompleteData : incompleteData?.graves;
        if (Array.isArray(rows)) setIncomplete(rows);
        const plotRows = Array.isArray(plotData) ? plotData : (plotData?.plots || []);
        if (Array.isArray(plotRows)) setPlots(plotRows);
        if (Array.isArray(requestData)) setRequests(requestData);
        if (Array.isArray(notificationData)) setNotifications(notificationData);
      })
      .catch((error) => {
        if (error.name !== "AbortError") console.error(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const plotCounts = countPlotStatuses(plots);
  const totalPlots = plots.length || 0;
  const pendingRequests = requests.filter((r) => r.status === "pending");
  const unread = notifications.filter((n) => !n.readAt).length;
  const verificationQueue = incomplete.slice(0, 5);

  // Percentages for capacity bar
  const occupiedPct = totalPlots ? Math.round((plotCounts.occupied / totalPlots) * 100) : 0;
  const availablePct = totalPlots ? Math.round((plotCounts.available / totalPlots) * 100) : 0;
  const reservedPct = totalPlots ? Math.round((plotCounts.reserved / totalPlots) * 100) : 0;
  const maintenancePct = totalPlots ? Math.round((plotCounts.maintenance / totalPlots) * 100) : 0;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${userName || "Staff"}`}
        description="Verify records, monitor plot status, and assist visitors."
        actions={
          <>
            <Button variant="secondary" href="/dashboard/map?locate=cemetery">
              <Compass size={16} />
              Locate Cemetery
            </Button>
            <Button variant="primary" href="/dashboard/verification">
              <BadgeCheck size={16} />
              Verify records
            </Button>
          </>
        }
      />

      {/* KPI Cards Grid */}
      <LocateGraveCard />

      <div className="grid grid-4 gap-md">
        <KpiCard
          loading={loading}
          title="Awaiting verification"
          value={incomplete.length}
          comparison={incomplete.length === 0 ? "Queue is clear" : "Records need review"}
          icon={BadgeCheck}
          iconVariant="danger"
          href="/dashboard/verification"
        />
        <KpiCard
          loading={loading}
          title="Available plots"
          value={plotCounts.available}
          comparison={`${plotCounts.occupied} occupied / ${plotCounts.reserved} reserved`}
          icon={MapPin}
          iconVariant="accent"
          href="/dashboard/plots"
        />
        <KpiCard
          loading={loading}
          title="Pending requests"
          value={pendingRequests.length}
          comparison="Awaiting admin decision"
          icon={ClipboardList}
          iconVariant="warning"
          href="/dashboard/requests"
        />
        <KpiCard
          loading={loading}
          title="Unread notifications"
          value={unread}
          comparison={`${notifications.length} total`}
          icon={Bell}
          iconVariant="primary"
          href="/dashboard/notifications"
        />
      </div>

      {/* Main Containers Layout below KPI cards */}
      <div className="grid grid-2 mt-lg gap-lg" style={{ gridTemplateColumns: "7fr 5fr" }}>
        
        {/* Left Column: Verification Queue & Visitor Requests */}
        <div className="flex flex-col gap-lg">
          
          {/* Container 1: Priority Verification Queue */}
          <div className="staff-card">
            <div className="staff-card-header">
              <div className="staff-card-title-group">
                <div className="staff-card-icon-badge danger">
                  <BadgeCheck size={28} />
                </div>
                <div>
                  <div className="staff-card-title">Verification Queue</div>
                  <div className="staff-card-subtitle">Incomplete grave records requiring staff inspection</div>
                </div>
              </div>
              <Link href="/dashboard/verification" className="btn btn-secondary btn-sm" style={{ gap: "0.35rem", fontSize: "0.8rem" }}>
                <span>View Queue</span>
                {incomplete.length > 0 && (
                  <span className="badge badge-danger" style={{ padding: "0.15rem 0.4rem", fontSize: "0.7rem" }}>
                    {incomplete.length}
                  </span>
                )}
              </Link>
            </div>

            <div className="staff-card-body" style={{ padding: 0 }}>
              {loading ? (
                <div className="p-4 flex flex-col gap-sm">
                  <Skeleton style={{ height: "45px", width: "100%" }} />
                  <Skeleton style={{ height: "45px", width: "100%" }} />
                  <Skeleton style={{ height: "45px", width: "100%" }} />
                </div>
              ) : verificationQueue.length === 0 ? (
                <div style={{ padding: "3rem 1.5rem", display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ color: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.85rem" }}>
                    <ShieldCheck size={26} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-primary)", marginBottom: "0.25rem" }}>
                    All Records Verified
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", maxWidth: "340px", margin: "0 0 1.25rem 0", lineHeight: 1.4, textAlign: "center" }}>
                    Great job! There are currently no incomplete records awaiting review in the system.
                  </p>
                  <Button variant="secondary" href="/dashboard/graves" style={{ fontSize: "0.85rem" }}>
                    <Search size={15} />
                    Browse Grave Directory
                  </Button>
                </div>
              ) : (
                <div className="table-container" style={{ border: "none", borderRadius: 0 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Deceased / Record</th>
                        <th>Location</th>
                        <th>Required Fields</th>
                        <th style={{ textAlign: "center" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {verificationQueue.map((grave) => (
                        <tr key={grave.id}>
                          <td>
                            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                              {grave.deceasedName || `Record #${grave.id}`}
                            </div>
                            <div className="text-xs text-muted">ID: {grave.id}</div>
                          </td>
                          <td>
                            <div className="text-sm" style={{ fontWeight: 500 }}>
                              {grave.plot?.plotNumber ? `Plot ${grave.plot.plotNumber}` : <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Unassigned</span>}
                            </div>
                            <div className="text-xs text-muted">{grave.plot?.section ? `Section ${grave.plot.section}` : "No section"}</div>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                              {getGapPills(grave)}
                            </div>
                          </td>
                          <td>
                            <div className="action-buttons justify-center">
                              <Link
                                href="/dashboard/verification"
                                className="btn btn-secondary btn-sm"
                                style={{ padding: "0.35rem 0.65rem", fontSize: "0.78rem", gap: "0.35rem" }}
                              >
                                <Eye size={14} />
                                Review
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {incomplete.length > 5 && (
                    <div className="table-footer">
                      <span className="text-xs text-muted">Showing 5 of {incomplete.length} pending records</span>
                      <Button variant="link" href="/dashboard/verification" style={{ fontSize: "0.825rem" }}>
                        View all {incomplete.length} pending records →
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Container 2: Visitor Requests Quick Queue */}
          <div className="staff-card">
            <div className="staff-card-header">
              <div className="staff-card-title-group">
                <div className="staff-card-icon-badge warning">
                  <ClipboardList size={28} />
                </div>
                <div>
                  <div className="staff-card-title">Pending Visitor Requests</div>
                  <div className="staff-card-subtitle">Visitor applications awaiting staff assistance</div>
                </div>
              </div>
              <Link href="/dashboard/requests" className="btn btn-secondary btn-sm" style={{ fontSize: "0.8rem" }}>
                <span>All Requests ({pendingRequests.length})</span>
              </Link>
            </div>

            <div className="staff-card-body">
              {loading ? (
                <Skeleton style={{ height: "100px", width: "100%" }} />
              ) : pendingRequests.length === 0 ? (
                <div style={{ padding: "1.5rem", color: "var(--text-muted)", fontSize: "0.875rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                  <CheckCircle2 size={18} style={{ color: "#10b981" }} />
                  <span>No pending visitor requests at this time.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-sm">
                  {pendingRequests.slice(0, 3).map((req) => (
                    <div key={req.id} className="request-item">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div style={{ width: "auto", height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>
                          <FileText size={16} />
                        </div>
                        <div>
                          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>
                            {req.type ? req.type.toUpperCase() : "Burial / Record Request"}
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                            By {req.user?.name || req.user?.email || "Visitor"} • {timeAgo(req.createdAt)}
                          </div>
                        </div>
                      </div>
                      <span className="badge badge-warning text-xs" style={{ fontSize: "0.72rem" }}>
                        Pending Admin
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Right Column: Plot Status Visual Analytics & System Activity Feed */}
        <div className="flex flex-col gap-lg">

          {/* Container 3: Plot Capacity Breakdown */}
          <div className="staff-card">
            <div className="staff-card-header">
              <div className="staff-card-title-group">
                <div className="staff-card-icon-badge accent">
                  <Layers size={28} />
                </div>
                <div>
                  <div className="staff-card-title">Cemetery Plot Capacity</div>
                  <div className="staff-card-subtitle">Real-time plot status distribution</div>
                </div>
              </div>
              <span className="badge badge-primary text-xs" style={{ fontWeight: 600 }}>
                {occupiedPct}% Occupied
              </span>
            </div>

            <div className="staff-card-body">
              {loading ? (
                <Skeleton style={{ height: "160px", width: "100%" }} />
              ) : (
                <>
                  {/* Multi-Segment Capacity Bar */}
                  <div className="plot-capacity-bar-track" title={`Occupied: ${occupiedPct}%, Available: ${availablePct}%, Reserved: ${reservedPct}%, Maintenance: ${maintenancePct}%`}>
                    <div className="plot-capacity-segment occupied" style={{ width: `${occupiedPct}%` }} />
                    <div className="plot-capacity-segment available" style={{ width: `${availablePct}%` }} />
                    <div className="plot-capacity-segment reserved" style={{ width: `${reservedPct}%` }} />
                    <div className="plot-capacity-segment maintenance" style={{ width: `${maintenancePct}%` }} />
                  </div>

                  {/* 2x2 Plot Stats Grid */}
                  <div className="plot-grid-stats">
                    <div className="plot-stat-box">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#2563eb" }} />
                        <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Occupied</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-primary)" }}>{plotCounts.occupied}</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{occupiedPct}%</div>
                      </div>
                    </div>

                    <div className="plot-stat-box">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981" }} />
                        <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Available</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-primary)" }}>{plotCounts.available}</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{availablePct}%</div>
                      </div>
                    </div>

                    <div className="plot-stat-box">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
                        <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Reserved</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-primary)" }}>{plotCounts.reserved}</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{reservedPct}%</div>
                      </div>
                    </div>

                    <div className="plot-stat-box">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#64748b" }} />
                        <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Maintenance</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-primary)" }}>{plotCounts.maintenance}</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{maintenancePct}%</div>
                      </div>
                    </div>
                  </div>

                  {plotCounts.unpinned > 0 && (
                    <div style={{ marginTop: "1rem", padding: "0.75rem 0.9rem", borderRadius: "8px", background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", color: "var(--warning)" }}>
                        <AlertTriangle size={15} />
                        <span><strong>{plotCounts.unpinned} plot{plotCounts.unpinned === 1 ? "" : "s"}</strong> not yet pinned on map.</span>
                      </div>
                      <Link href="/dashboard/map" style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--warning)", textDecoration: "none" }}>
                        Pin on Map →
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Container 4: Activity & System Notifications */}
          <div className="staff-card">
            <div className="staff-card-header">
              <div className="staff-card-title-group">
                <div className="staff-card-icon-badge primary">
                  <Bell size={28} />
                </div>
                <div>
                  <div className="staff-card-title">System Activity</div>
                  <div className="staff-card-subtitle">Latest staff alerts and system updates</div>
                </div>
              </div>
              <Link href="/dashboard/notifications" className="btn btn-secondary btn-sm" style={{ fontSize: "0.8rem" }}>
                <span>Center ({notifications.length})</span>
              </Link>
            </div>

            <div className="staff-card-body">
              {loading ? (
                <Skeleton style={{ height: "120px", width: "100%" }} />
              ) : notifications.length === 0 ? (
                <p className="text-sm text-muted" style={{ margin: 0 }}>No recent notifications.</p>
              ) : (
                <div className="flex flex-col gap-sm">
                  {notifications.slice(0, 4).map((n) => (
                    <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", padding: "0.6rem 0", borderBottom: "1px solid var(--border-default)" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: n.readAt ? "var(--text-muted)" : "var(--primary)", marginTop: "6px", flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
                          {n.title || "Notification"}
                        </div>
                        {n.message && (
                          <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                            {n.message}
                          </div>
                        )}
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "4px", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <Clock size={12} />
                          <span>{timeAgo(n.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>

      </div>
    </>
  );
}

function getGapPills(grave) {
  const pills = [];
  if (!grave?.plot?.plotNumber) {
    pills.push(
      <span key="plot" className="gap-pill">
        Unassigned Plot
      </span>
    );
  }
  if (grave?.plot && (grave.plot.gpsLat == null || grave.plot.gpsLng == null)) {
    pills.push(
      <span key="gps" className="gap-pill">
        No GPS
      </span>
    );
  }
  if (!grave?.burialDate) {
    pills.push(
      <span key="date" className="gap-pill">
        Burial Date
      </span>
    );
  }
  if (pills.length === 0) {
    return <span className="badge badge-warning text-xs">Pending Review</span>;
  }
  return pills;
}
