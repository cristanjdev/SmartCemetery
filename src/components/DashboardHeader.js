"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  Search, Moon, Sun, Bell, User, LogOut, X, CornerDownLeft,
  LayoutDashboard, Archive, MapPin, Map, ClipboardList, Users,
  MessageSquare, LineChart, Megaphone, ScrollText, BadgeCheck, CheckCheck,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useIsClient } from "@/lib/use-is-client";
import { SITE_NAME } from "@/lib/config";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

const STAFF_NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Graves", href: "/dashboard/graves", icon: Archive },
  { label: "Verification", href: "/dashboard/verification", icon: BadgeCheck },
  { label: "Plots", href: "/dashboard/plots", icon: MapPin },
  { label: "Map", href: "/dashboard/map", icon: Map },
  { label: "Requests", href: "/dashboard/requests", icon: ClipboardList },
  { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
  { label: "Feedback", href: "/dashboard/feedback", icon: MessageSquare },
];

const CLIENT_NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Search Graves", href: "/dashboard/search", icon: Search },
  { label: "Interactive Map", href: "/dashboard/map", icon: Map },
  { label: "My Requests", href: "/dashboard/requests", icon: ClipboardList },
  { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
  { label: "Feedback", href: "/dashboard/feedback", icon: MessageSquare },
];

/* Searchable destinations by role (mirrors the sidebar navigation). */
const ROUTES = {
  Admin: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Graves", href: "/dashboard/graves", icon: Archive },
    { label: "Search Graves", href: "/dashboard/search", icon: Search },
    { label: "Plots", href: "/dashboard/plots", icon: MapPin },
    { label: "Locations", href: "/dashboard/locations", icon: Map },
    { label: "Map", href: "/dashboard/map", icon: Map },
    { label: "Requests", href: "/dashboard/requests", icon: ClipboardList },
    { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
    { label: "Broadcasts", href: "/dashboard/broadcasts", icon: Megaphone },
    { label: "User Log", href: "/dashboard/user-log", icon: ScrollText },
    { label: "Verification", href: "/dashboard/verification", icon: BadgeCheck },
    { label: "Users", href: "/dashboard/users", icon: Users },
    { label: "Feedback", href: "/dashboard/feedback", icon: MessageSquare },
    { label: "Reports", href: "/dashboard/reports", icon: LineChart },
  ],
  Staff: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Graves", href: "/dashboard/graves", icon: Archive },
    { label: "Search Graves", href: "/dashboard/search", icon: Search },
    { label: "Plots", href: "/dashboard/plots", icon: MapPin },
    { label: "Map", href: "/dashboard/map", icon: Map },
    { label: "Requests", href: "/dashboard/requests", icon: ClipboardList },
    { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
    { label: "Verification", href: "/dashboard/verification", icon: BadgeCheck },
    { label: "Feedback", href: "/dashboard/feedback", icon: MessageSquare },
  ],
  Client: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Search", href: "/dashboard/search", icon: Search },
    { label: "Map", href: "/dashboard/map", icon: Map },
    { label: "My Requests", href: "/dashboard/requests", icon: ClipboardList },
    { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
    { label: "Feedback", href: "/dashboard/feedback", icon: MessageSquare },
  ],
};

function timeAgo(dateStr) {
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function DashboardHeader() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const mounted = useIsClient();

  // Theme is initialized before paint in the root layout. null keeps SSR and
  // the first client render identical while the control synchronizes.
  const [theme, setTheme] = useState(null);

  // Command palette (search / jump to)
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const searchInputRef = useRef(null);

  // Notifications drawer
  const [showNotif, setShowNotif] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);

  useBodyScrollLock(showSearch || showNotif);

  const role = session?.user?.role || "Client";
  const userName = session?.user?.name || "User";
  const routes = ROUTES[role] || ROUTES.Client;

  // Set data-role attribute on html element for role-specific CSS layout overrides
  useEffect(() => {
    if (role) {
      document.documentElement.setAttribute("data-role", role.toLowerCase());
    }
  }, [role]);

  const paths = pathname ? pathname.split("/").filter(Boolean) : [];
  // "user-log" → "User Log"
  const currentPage = paths.length > 1
    ? paths[paths.length - 1]
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : "Dashboard";

  const filteredRoutes = query.trim()
    ? routes.filter((r) => r.label.toLowerCase().includes(query.trim().toLowerCase()))
    : routes;

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  /* ── Theme init + toggle ─────────────────────────────── */
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");

    const resolveTheme = () => {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") return saved;
      return media.matches ? "light" : "dark";
    };

    const applyTheme = (next) => {
      setTheme(next);
      document.documentElement.setAttribute("data-theme", next);
      document.documentElement.style.colorScheme = next;
    };

    applyTheme(resolveTheme());

    // Follow OS theme changes whenever the user has not chosen an override.
    const onSystemThemeChange = () => {
      if (!localStorage.getItem("theme")) applyTheme(resolveTheme());
    };
    const onStorage = (event) => {
      if (event.key === "theme") applyTheme(resolveTheme());
    };

    media.addEventListener("change", onSystemThemeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystemThemeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const toggleTheme = () => {
    const current = theme || document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    document.documentElement.style.colorScheme = next;
  };

  /* ── Notifications ───────────────────────────────────── */
  const loadNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(Array.isArray(data) ? data : []);
      }
    } catch {
      /* silent — badge simply won't update */
    } finally {
      setNotifLoading(false);
    }
  }, []);

  // Initial fetch for the unread badge. Keep loading state untouched here so
  // opening the drawer remains the only operation that shows its loader.
  useEffect(() => {
    if (!session) return undefined;

    let cancelled = false;
    fetch("/api/notifications")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setNotifications(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        /* silent — badge simply won't update */
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  const openNotif = () => {
    setShowNotif(true);
    loadNotifications();
  };

  const markRead = async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
    );
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* optimistic update already applied */
    }
  };

  /* ── Command palette open/close + keyboard ───────────── */
  const openSearch = useCallback(() => {
    setShowSearch(true);
    setQuery("");
    setActiveIdx(0);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSearch((v) => !v);
        setQuery("");
        setActiveIdx(0);
      } else if (e.key === "Escape") {
        setShowSearch(false);
        setShowNotif(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (showSearch && searchInputRef.current) searchInputRef.current.focus();
  }, [showSearch]);

  const go = (href) => {
    setShowSearch(false);
    router.push(href);
  };

  const onSearchKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filteredRoutes.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filteredRoutes[activeIdx];
      if (target) go(target.href);
    }
  };

  return (
    <>
      <header className="header">
        {/* Left side: Breadcrumbs & Brand Title for Staff/Client */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
          {(role === "Staff" || role === "Client") && (
            <>
              <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "0.95rem", letterSpacing: "-0.01em" }}>
                {SITE_NAME}
              </span>
              <span style={{ color: "var(--text-muted)", opacity: 0.5 }}>/</span>
            </>
          )}
          <span style={{ color: (role === "Staff" || role === "Client") ? "var(--text-secondary)" : "var(--text-primary)", fontWeight: 500 }}>
            {currentPage}
          </span>
        </div>

        {/* Right side: Actions & Profile */}
        <div className="header-right" style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>

          {/* Search trigger */}
          <button
            onClick={openSearch}
            style={{
              display: "flex", alignItems: "center", background: "var(--bg-hover)",
              border: "1px solid var(--border-default)", borderRadius: "6px",
              padding: "0.4rem 0.75rem", gap: "0.5rem", width: "240px", cursor: "text",
              color: "var(--text-muted)",
            }}
            className="hidden md:flex"
            aria-label="Open search"
          >
            <Search size={14} style={{ color: "var(--text-muted)" }} />
            <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", flex: 1, textAlign: "left" }}>Search or jump to...</span>
            <span style={{
              background: "rgba(148,163,184,0.18)", padding: "0.1rem 0.3rem",
              borderRadius: "4px", fontSize: "0.65rem", color: "var(--text-secondary)",
              fontWeight: 600, letterSpacing: "1px",
            }}>
              ⌘K
            </span>
          </button>

          {/* Theme toggle */}
          <button
            className="hf-icon-btn"
            onClick={toggleTheme}
            title={(theme || "dark") === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={(theme || "dark") === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-pressed={(theme || "dark") === "light"}
          >
            {(theme || "dark") === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Notifications */}
          <button className="hf-icon-btn" onClick={openNotif} title="Notifications" aria-label="Open notifications">
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="hf-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
            )}
          </button>

          <div style={{ width: "1px", height: "24px", background: "var(--border-default)", margin: "0 0.25rem" }} />

          {/* User Profile */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{
              width: "auto", height: "32px", display: "flex",
              alignItems: "center", justifyContent: "center", color: "var(--text-secondary)",
            }}>
              <User size={16} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }} className="hidden sm:flex">
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2 }}>
                {userName}
              </div>
            </div>
          </div>

          {/* Logout button */}
          <button
            onClick={() => setShowLogoutModal(true)}
            style={{
              background: "none", border: "none", color: "var(--danger)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", padding: "0.4rem",
              borderRadius: "6px", marginLeft: "-0.5rem",
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)")}
            onMouseOut={(e) => (e.currentTarget.style.background = "none")}
            title="Sign Out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* ── Secondary Header Sub-Navigation (Staff & Client) ─────────────── */}
      {(role === "Staff" || role === "Client") && (
        <nav className="staff-secondary-header" aria-label={`${role} Navigation`}>
          <div className="staff-nav-container">
            {(role === "Staff" ? STAFF_NAV_ITEMS : CLIENT_NAV_ITEMS).map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`staff-nav-link ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={16} className="staff-nav-icon" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* ── Command Palette ─────────────────────────────── */}
      {showSearch && mounted && createPortal(
        <>
          <div className="hf-overlay" onClick={() => setShowSearch(false)} />
          <div className="hf-cmd-wrap">
            <div className="hf-cmd" role="dialog" aria-label="Search">
              <div className="hf-cmd-input-row">
                <Search size={18} style={{ color: "var(--text-muted)" }} />
                <input
                  ref={searchInputRef}
                  className="hf-cmd-input"
                  placeholder="Search pages or jump to..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIdx(0);
                  }}
                  onKeyDown={onSearchKeyDown}
                />
                <button className="hf-icon-btn" onClick={() => setShowSearch(false)} aria-label="Close search">
                  <X size={16} />
                </button>
              </div>
              <div className="hf-cmd-list">
                {filteredRoutes.length === 0 ? (
                  <div className="hf-cmd-empty">No matching pages</div>
                ) : (
                  filteredRoutes.map((r, i) => {
                    const Icon = r.icon;
                    return (
                      <button
                        key={r.href}
                        className={`hf-cmd-item ${i === activeIdx ? "active" : ""}`}
                        onMouseEnter={() => setActiveIdx(i)}
                        onClick={() => go(r.href)}
                      >
                        <Icon size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{r.label}</span>
                        {i === activeIdx && <CornerDownLeft size={14} style={{ color: "var(--text-muted)" }} />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ── Notification Drawer ─────────────────────────── */}
      {showNotif && mounted && createPortal(
        <>
          <div className="hf-overlay" onClick={() => setShowNotif(false)} />
          <aside className="hf-drawer" role="dialog" aria-label="Notifications">
            <div className="hf-drawer-head">
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Bell size={18} style={{ color: "var(--text-primary)" }} />
                <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--text-primary)" }}>Notifications</h3>
                {unreadCount > 0 && (
                  <span style={{
                    fontSize: "0.7rem", fontWeight: 700, color: "#fff", background: "var(--primary)",
                    borderRadius: "10px", padding: "0.05rem 0.4rem",
                  }}>{unreadCount}</span>
                )}
              </div>
              <button className="hf-icon-btn" onClick={() => setShowNotif(false)} aria-label="Close notifications">
                <X size={18} />
              </button>
            </div>
            <div className="hf-drawer-body">
              {notifLoading && notifications.length === 0 ? (
                <div className="hf-cmd-empty">Loading...</div>
              ) : notifications.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-muted)" }}>
                  <Bell size={32} style={{ opacity: 0.4, marginBottom: "0.75rem" }} />
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>You&apos;re all caught up</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`hf-notif ${!n.readAt ? "unread" : ""}`}
                    onClick={() => !n.readAt && markRead(n.id)}
                  >
                    <span
                      className="hf-notif-dot"
                      style={{ background: n.readAt ? "transparent" : "var(--primary)" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>
                        {n.title || "Notification"}
                      </div>
                      {n.message && (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.15rem", lineHeight: 1.4 }}>
                          {n.message}
                        </div>
                      )}
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.35rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        {timeAgo(n.createdAt)}
                        {!n.readAt && <span style={{ color: "var(--primary)", fontWeight: 600 }}>• New</span>}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{ borderTop: "1px solid var(--border-default)", padding: "0.75rem" }}>
              <button
                className="btn btn-ghost"
                style={{ width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: "0.5rem" }}
                onClick={() => { setShowNotif(false); router.push("/dashboard/notifications"); }}
              >
                <CheckCheck size={16} /> View all notifications
              </button>
            </div>
          </aside>
        </>,
        document.body
      )}

      {/* Logout Confirmation Modal */}
      <ConfirmDialog
        open={showLogoutModal}
        title="Sign Out"
        description="Are you sure you want to sign out of your account?"
        confirmLabel="Sign Out"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={() => signOut({ callbackUrl: "/login" })}
        onCancel={() => setShowLogoutModal(false)}
      />
    </>
  );
}
