"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, Map, ClipboardList, Bell, MessageSquare, ArrowRight,
  Clock, FileText, Plus, Compass
} from "lucide-react";
import { PageHeader } from "./PageHeader";
import { KpiCard } from "./KpiCard";
import { LocateGraveCard } from "./LocateGraveCard";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { timeAgo } from "../../lib/dashboard-metrics";

const STATUS_VARIANT = {
  approved: "success",
  rejected: "danger",
  pending: "warning",
  completed: "success",
};

/**
 * Client (visitor) dashboard — 100% user-friendly workspace.
 * Covers visitor use cases: search a grave, view map guide, submit and track requests, give feedback.
 */
export function ClientDashboard({ userName }) {
  const router = useRouter();
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

    Promise.all([load("/api/requests"), load("/api/notifications")])
      .then(([requestData, notificationData]) => {
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

  const pending = requests.filter((r) => r.status === "pending").length;
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title={`Welcome, ${userName || "Visitor"}`}
        description="Search burial records, locate graves on map, and manage requests."
        actions={
          <>
            <Button variant="secondary" href="/dashboard/map?locate=cemetery">
              <Compass size={16} />
              Locate Cemetery Map
            </Button>
            <Button variant="primary" href="/dashboard/search">
              <Search size={16} />
              Find a Grave
            </Button>
          </>
        }
      />

      {/* Locate Cemetery Banner for New Logins */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)",
          border: "1px solid rgba(59, 130, 246, 0.25)",
          borderRadius: "var(--radius-lg)",
          padding: "1.25rem 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "var(--space-lg)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div
            style={{
              width: "auto",
              height: 42,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--primary-light, #60a5fa)",
              flexShrink: 0
            }}
          >
            <Compass size={22} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-primary)" }}>
              Locate the Cemetery on the Interactive Map
            </div>
            <div style={{ fontSize: "0.825rem", color: "var(--text-secondary)" }}>
              Explore satellite views of cemetery grounds, search plots, and get pedestrian walking directions.
            </div>
          </div>
        </div>
        <Button variant="primary" href="/dashboard/map?locate=cemetery" style={{ whiteSpace: "nowrap" }}>
          <Compass size={16} /> Locate Cemetery
        </Button>
      </div>

      <LocateGraveCard />

      {/* KPI Cards Grid */}
      <div className="grid grid-4 gap-md">
        <KpiCard
          loading={loading}
          title="My submitted requests"
          value={requests.length}
          comparison={`${pending} awaiting staff decision`}
          icon={ClipboardList}
          iconVariant="primary"
          href="/dashboard/requests"
        />
        <KpiCard
          loading={loading}
          title="Unread updates"
          value={unread}
          comparison={`${notifications.length} total notifications`}
          icon={Bell}
          iconVariant="warning"
          href="/dashboard/notifications"
        />
        <KpiCard
          loading={false}
          title="Grave Directory"
          value="Lookup"
          comparison="Search name or ID"
          icon={Search}
          iconVariant="accent"
          href="/dashboard/search"
        />
        <KpiCard
          loading={false}
          title="Visitor Assistance"
          value="Feedback"
          comparison="Rate your experience"
          icon={MessageSquare}
          iconVariant="danger"
          href="/dashboard/feedback"
        />
      </div>

      {/* Main Containers Layout below KPI cards */}
      <div className="grid grid-2 mt-lg gap-lg" style={{ gridTemplateColumns: "7fr 5fr" }}>
        
        {/* Left Column: My Submitted Requests */}
        <div className="staff-card">
          <div className="staff-card-header">
            <div className="staff-card-title-group">
              <div className="staff-card-icon-badge primary">
                <ClipboardList size={28} />
              </div>
              <div>
                <div className="staff-card-title">My Recent Requests</div>
                <div className="staff-card-subtitle">Track burial, maintenance, and record requests</div>
              </div>
            </div>
            <Link href="/dashboard/requests" className="btn btn-secondary btn-sm" style={{ gap: "0.35rem", fontSize: "0.8rem" }}>
              <Plus size={14} />
              <span>New Request</span>
            </Link>
          </div>

          <div className="staff-card-body" style={{ padding: 0 }}>
            {loading ? (
              <div className="p-4 flex flex-col gap-sm">
                <Skeleton style={{ height: "45px", width: "100%" }} />
                <Skeleton style={{ height: "45px", width: "100%" }} />
              </div>
            ) : requests.length === 0 ? (
              <div style={{ padding: "3rem 1.5rem", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                <div style={{ color: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.85rem" }}>
                  <FileText size={24} />
                </div>
                <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-primary)", marginBottom: "0.25rem" }}>
                  No Requests Submitted Yet
                </div>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", maxWidth: "340px", margin: "0 0 1.25rem 0", lineHeight: 1.4, textAlign: "center" }}>
                  Submit a request for grave maintenance, burial permit inquiries, or record corrections.
                </p>
                <Button variant="primary" href="/dashboard/requests" style={{ fontSize: "0.85rem" }}>
                  <Plus size={15} />
                  Submit Your First Request
                </Button>
              </div>
            ) : (
              <div className="table-container" style={{ border: "none", borderRadius: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reference ID</th>
                      <th>Request Type</th>
                      <th>Status</th>
                      <th>Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.slice(0, 5).map((request) => (
                      <tr key={request.id}>
                        <td>
                          <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                            {request.referenceId || `#${request.id}`}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{formatType(request.type)}</div>
                        </td>
                        <td>
                          <span className={`badge badge-${STATUS_VARIANT[request.status] || "muted"}`}>
                            {request.status}
                          </span>
                        </td>
                        <td className="text-xs text-muted">{timeAgo(request.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="table-footer">
                  <span className="text-xs text-muted">Showing {Math.min(5, requests.length)} of {requests.length} requests</span>
                  <Button variant="link" href="/dashboard/requests" style={{ fontSize: "0.825rem" }}>
                    View all my requests →
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Latest Updates & Visitor Quick Tools */}
        <div className="flex flex-col gap-lg">

          {/* Latest Updates & System Notifications */}
          <div className="staff-card">
            <div className="staff-card-header">
              <div className="staff-card-title-group">
                <div className="staff-card-icon-badge warning">
                  <Bell size={28} />
                </div>
                <div>
                  <div className="staff-card-title">Latest Updates</div>
                  <div className="staff-card-subtitle">Request notifications and public updates</div>
                </div>
              </div>
              <Link href="/dashboard/notifications" className="btn btn-secondary btn-sm" style={{ fontSize: "0.8rem" }}>
                <span>Center ({notifications.length})</span>
              </Link>
            </div>

            <div className="staff-card-body">
              {loading ? (
                <Skeleton style={{ height: "100px", width: "100%" }} />
              ) : notifications.length === 0 ? (
                <div style={{ textAlign: "center", padding: "1.25rem 0", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  No updates yet. You will be notified here when your requests are processed.
                </div>
              ) : (
                <div className="flex flex-col gap-sm">
                  {notifications.slice(0, 3).map((n) => (
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

          {/* Visitor Navigation Hub */}
          <div className="staff-card">
            <div className="staff-card-header">
              <div className="staff-card-title-group">
                <div className="staff-card-icon-badge accent">
                  <Compass size={28} />
                </div>
                <div>
                  <div className="staff-card-title">Visitor Services & Navigation</div>
                  <div className="staff-card-subtitle">Common visitor tools and map guide</div>
                </div>
              </div>
            </div>

            <div className="staff-card-body" style={{ padding: 0 }}>
              {[
                { href: "/dashboard/search", icon: Search, label: "Grave Search & Record Lookup", hint: "Find by deceased name, ID, or burial year" },
                { href: "/dashboard/map", icon: Map, label: "Interactive Cemetery Map", hint: "Get walking directions & locate plot coordinates" },
                { href: "/dashboard/requests", icon: ClipboardList, label: "Submit Visitor Request", hint: "Request maintenance, permit, or grave updates" },
                { href: "/dashboard/feedback", icon: MessageSquare, label: "Provide Feedback", hint: "Rate your visit experience & suggest improvements" },
              ].map((action, index) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className="request-item"
                    style={{
                      borderRadius: 0,
                      border: "none",
                      borderTop: index === 0 ? "none" : "1px solid var(--border-default)",
                      padding: "0.95rem 1.25rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
                      <div style={{ color: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon size={24} />
                      </div>
                      <div>
                        <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>
                          {action.label}
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                          {action.hint}
                        </div>
                      </div>
                    </div>
                    <ArrowRight size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  </Link>
                );
              })}
            </div>
          </div>

        </div>

      </div>
    </>
  );
}

function formatType(type) {
  if (!type) return "Request";
  return String(type).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
