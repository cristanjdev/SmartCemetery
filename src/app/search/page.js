"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  X,
  ChevronRight,
  ChevronDown,
  User,
  MapPin,
  Calendar,
  LayoutGrid,
  List,
  RotateCcw,
  Navigation,
} from "lucide-react";
import { PublicThemeToggle } from "@/components/ui/PublicThemeToggle";
import { SITE_NAME } from "@/lib/config";

const FALLBACK_PHOTO = "/images/memorial_headstone.jpg";

// Queries that list the whole registry instead of searching for a name.
const BROWSE_ALL_QUERY = "all";
function isBrowseAllQuery(value) {
  const q = String(value || "").trim().toLowerCase();
  return q === BROWSE_ALL_QUERY || q === "*" || q === "%";
}

function SearchPanel({ initialQuery }) {
  const router = useRouter();

  // Keep the box empty while browsing so visitors never see a wildcard.
  const [inputVal, setInputVal] = useState(isBrowseAllQuery(initialQuery) ? "" : initialQuery);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(Boolean(initialQuery));
  const [isScrolled, setIsScrolled] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name-asc");
  const [viewMode, setViewMode] = useState("grid");

  // Scroll listener for sticky nav glassmorphism
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Fetch search records
  const runSearch = useCallback(async (searchTerm) => {
    const trimmed = searchTerm.trim();
    if (!trimmed) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/graves?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      setResults(data);
    } catch (err) {
      console.error("Search fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery) {
      void Promise.resolve().then(() => runSearch(initialQuery));
    }
  }, [initialQuery, runSearch]);

  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    const searchTerm = inputVal.trim();
    if (!searchTerm) {
      router.push("/search");
      return;
    }
    router.push(`/search?q=${encodeURIComponent(searchTerm)}`);
  };

  const handleClear = () => {
    setInputVal("");
  };

  const handleBrowseAll = () => {
    setInputVal("");
    router.push(`/search?q=${BROWSE_ALL_QUERY}`);
  };

  // Derive filtered and sorted exact matches directly during render
  const rawExact = results?.exact || [];
  let processedExact = [...rawExact];

  if (statusFilter === "active") {
    processedExact = processedExact.filter((g) => g.status === "active");
  } else if (statusFilter === "archived") {
    processedExact = processedExact.filter((g) => g.status === "archived");
  }

  processedExact.sort((a, b) => {
    if (sortBy === "name-asc") {
      return (a.deceasedName || "").localeCompare(b.deceasedName || "");
    }
    if (sortBy === "name-desc") {
      return (b.deceasedName || "").localeCompare(a.deceasedName || "");
    }
    if (sortBy === "burial-desc") {
      const dateA = a.burialDate ? new Date(a.burialDate).getTime() : 0;
      const dateB = b.burialDate ? new Date(b.burialDate).getTime() : 0;
      return dateB - dateA;
    }
    if (sortBy === "burial-asc") {
      const dateA = a.burialDate ? new Date(a.burialDate).getTime() : 0;
      const dateB = b.burialDate ? new Date(b.burialDate).getTime() : 0;
      return dateA - dateB;
    }
    if (sortBy === "plot-asc") {
      return String(a.plot?.plotNumber || "").localeCompare(
        String(b.plot?.plotNumber || ""),
        undefined,
        { numeric: true }
      );
    }
    return 0;
  });

  const counts = {
    all: rawExact.length,
    active: rawExact.filter((g) => g.status === "active").length,
    archived: rawExact.filter((g) => g.status === "archived").length,
  };

  return (
    <div className="public-page-wrapper">
      <div className="premium-bg-mesh" aria-hidden="true"></div>

      {/* Navigation Header */}
      <nav className={`premium-nav ${isScrolled ? "scrolled" : ""}`}>
        <Link href="/" className="premium-brand">
          <span>{SITE_NAME}</span>
        </Link>
        <div className="premium-nav-links">
          <Link href="/kiosk" className="btn btn-ghost">
            Map Navigator
          </Link>
          <PublicThemeToggle />
          <Link href="/login" className="btn btn-ghost" style={{ width: '44px', padding: 0 }} aria-label="Admin Login" title="Admin Login">
            <User size={20} />
          </Link>
        </div>
      </nav>

      {/* Main Search Content Container */}
      <main className="search-page-container">
        {/* Header Hero Area */}
        <section className="search-hero">
          <h1 className="search-title">
            <span className="premium-title-highlight">Search Cemetery Records</span>
          </h1>

          <p className="search-subtitle">
            Find deceased records by name, grave identifier, or burial year, or browse the complete registry.
          </p>

          {/* Search Form Shell */}
          <form onSubmit={handleSearchSubmit} className="search-form-shell" role="search">
            <div className="search-input-group">
              <div className="search-input-field-wrapper">
                <div className="search-field-icon" aria-hidden="true">
                  <Search size={20} />
                </div>
                <input
                  type="text"
                  className="search-main-input"
                  autoComplete="off"
                  placeholder="Search by deceased name, grave ID, or burial year..."
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  aria-label="Search records by name, ID, or year"
                  autoFocus
                />
                {inputVal.length > 0 && (
                  <button
                    type="button"
                    className="search-clear-btn"
                    onClick={handleClear}
                    aria-label="Clear search text"
                    title="Clear"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <button type="submit" className="btn btn-primary search-submit-btn" aria-label="Submit search">
                <Search size={18} aria-hidden="true" />
                <span>Search</span>
              </button>
            </div>
          </form>

        </section>

        {/* Results Area */}
        <section style={{ minHeight: "45vh" }} aria-live="polite">
          {loading ? (
            /* Modern Skeleton Loading Cards */
            <div style={{ marginTop: "2rem" }}>
              <div className="search-grid-layout">
                {[1, 2, 3, 4, 5, 6].map((idx) => (
                  <div key={idx} className="skeleton-card">
                    <div className="skeleton-media skeleton-shimmer" />
                    <div className="skeleton-body">
                      <div className="skeleton-shimmer" style={{ height: "22px", width: "70%" }} />
                      <div className="skeleton-shimmer" style={{ height: "16px", width: "85%" }} />
                      <div className="skeleton-shimmer" style={{ height: "16px", width: "50%" }} />
                      <div className="skeleton-shimmer" style={{ height: "44px", marginTop: "0.5rem", width: "100%" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : results ? (
            <div>
              {/* Toolbar: Filter by Status, Sort, View Switcher (Only when records exist) */}
              {rawExact.length > 0 && (
                <div className="search-toolbar">
                  {/* Status Filter Pills */}
                  <div className="search-filter-pills" role="group" aria-label="Filter by burial status">
                    <button
                      type="button"
                      className={`search-filter-pill ${statusFilter === "all" ? "active" : ""}`}
                      onClick={() => setStatusFilter("all")}
                    >
                      <span>All</span>
                      <span className="search-filter-count">{counts.all}</span>
                    </button>
                    <button
                      type="button"
                      className={`search-filter-pill ${statusFilter === "active" ? "active" : ""}`}
                      onClick={() => setStatusFilter("active")}
                    >
                      <span>Active</span>
                      <span className="search-filter-count">{counts.active}</span>
                    </button>
                    <button
                      type="button"
                      className={`search-filter-pill ${statusFilter === "archived" ? "active" : ""}`}
                      onClick={() => setStatusFilter("archived")}
                    >
                      <span>Archived</span>
                      <span className="search-filter-count">{counts.archived}</span>
                    </button>
                  </div>

                  <div className="search-toolbar-right">
                    {/* Sort Selector */}
                    <div className="search-sort-wrap">
                      <select
                        className="search-sort-select"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        aria-label="Sort search results"
                      >
                        <option value="name-asc">Name (A → Z)</option>
                        <option value="name-desc">Name (Z → A)</option>
                        <option value="burial-desc">Burial Date (Newest)</option>
                        <option value="burial-asc">Burial Date (Oldest)</option>
                        <option value="plot-asc">Plot Number</option>
                      </select>
                      <ChevronDown size={16} className="search-sort-chevron" aria-hidden="true" />
                    </div>

                    {/* View Switcher: Grid vs List */}
                    <div className="search-view-toggle" role="group" aria-label="Layout view mode">
                      <button
                        type="button"
                        className={`search-view-btn ${viewMode === "grid" ? "active" : ""}`}
                        onClick={() => setViewMode("grid")}
                        aria-label="Grid card view"
                        title="Grid view"
                      >
                        <LayoutGrid size={18} />
                      </button>
                      <button
                        type="button"
                        className={`search-view-btn ${viewMode === "list" ? "active" : ""}`}
                        onClick={() => setViewMode("list")}
                        aria-label="Compact list view"
                        title="List view"
                      >
                        <List size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Phonetic Suggestion Banner */}
              {results.suggestions?.length > 0 && rawExact.length === 0 && (
                <div
                  style={{
                    padding: "1rem 1.25rem",
                    marginBottom: "2rem",
                    borderRadius: "14px",
                    background: "rgba(14, 165, 233, 0.1)",
                    border: "1px solid rgba(14, 165, 233, 0.25)",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    color: "var(--text-primary)",
                  }}
                >
                  <Search size={18} style={{ color: "var(--info)", flexShrink: 0 }} />
                  <span style={{ fontSize: "0.95rem" }}>
                    No exact match found for <strong>&ldquo;{initialQuery}&rdquo;</strong>. Showing closest phonetic matches:
                  </span>
                </div>
              )}

              {/* Exact / Filtered Matches */}
              {processedExact.length > 0 && (
                <div style={{ marginBottom: "3rem" }}>
                  {viewMode === "grid" ? (
                    <div className="search-grid-layout">
                      {processedExact.map((grave) => (
                        <GraveCard key={grave.id} grave={grave} />
                      ))}
                    </div>
                  ) : (
                    <div className="search-list-layout">
                      {processedExact.map((grave) => (
                        <GraveCardList key={grave.id} grave={grave} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Phonetic Suggestions Section */}
              {results.suggestions?.length > 0 && (
                <div style={{ marginBottom: "3rem" }}>
                  <h3
                    style={{
                      fontSize: "0.85rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--text-muted)",
                      marginBottom: "1rem",
                      paddingLeft: "0.25rem",
                      fontWeight: 600,
                    }}
                  >
                    Suggested Phonetic Matches
                  </h3>
                  {viewMode === "grid" ? (
                    <div className="search-grid-layout">
                      {results.suggestions.map((grave) => (
                        <GraveCard key={grave.id} grave={grave} />
                      ))}
                    </div>
                  ) : (
                    <div className="search-list-layout">
                      {results.suggestions.map((grave) => (
                        <GraveCardList key={grave.id} grave={grave} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Nearby Sections */}
              {results.nearby?.length > 0 && (
                <div style={{ marginTop: "2rem", marginBottom: "3rem" }}>
                  <h3
                    style={{
                      fontSize: "0.85rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--text-muted)",
                      marginBottom: "1rem",
                      paddingLeft: "0.25rem",
                      fontWeight: 600,
                    }}
                  >
                    Adjacent Plots in Nearby Sections
                  </h3>
                  {viewMode === "grid" ? (
                    <div className="search-grid-layout">
                      {results.nearby.map((grave) => (
                        <GraveCard key={grave.id} grave={grave} />
                      ))}
                    </div>
                  ) : (
                    <div className="search-list-layout">
                      {results.nearby.map((grave) => (
                        <GraveCardList key={grave.id} grave={grave} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Empty State */}
              {rawExact.length === 0 &&
                results.suggestions?.length === 0 &&
                results.nearby?.length === 0 && (
                  <div className="search-empty-card">
                    <div className="search-empty-icon-wrap" aria-hidden="true">
                      <Search size={36} />
                    </div>
                    <h2 className="search-empty-title">No Records Found</h2>
                    <p className="search-empty-desc">
                      We could not find any cemetery records matching{" "}
                      <strong>&ldquo;{initialQuery}&rdquo;</strong>. Try adjusting your spelling, searching by year, or browse all records.
                    </p>
                    <div className="search-empty-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleBrowseAll}
                        style={{ minHeight: "44px" }}
                      >
                        <RotateCcw size={16} aria-hidden="true" />
                        <span>Browse All Records</span>
                      </button>
                    </div>
                  </div>
                )}
            </div>
          ) : (
            /* Initial Browse Prompt */
            <div className="search-empty-card">
              <h2 className="search-empty-title">Explore the Cemetery Registry</h2>
              <p className="search-empty-desc">
                Enter a deceased name, grave identifier, or year above to search records, or view the complete catalog.
              </p>
              <div className="search-empty-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleBrowseAll}
                  style={{ minHeight: "44px" }}
                >
                  <Search size={16} aria-hidden="true" />
                  <span>Browse All Records</span>
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="premium-footer">
        <p>© {new Date().getFullYear()} {SITE_NAME} Platform. Digital Heritage &amp; Memorial Navigation.</p>
      </footer>
    </div>
  );
}

/**
 * Modern Responsive Grid Grave Card with Full Landscape Photo
 */
function GraveCard({ grave }) {
  const detail = grave.plot?.locationDetail;
  const photos = grave.plot?.photos || [];
  const photo =
    photos.find((p) => p.tier === grave.tier)?.url ||
    photos.find((p) => p.tier === 0)?.url ||
    FALLBACK_PHOTO;

  const burialDate = grave.burialDate
    ? new Date(grave.burialDate).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const sectionName = detail?.location?.name || "Bolonsiri Cemetery";
  const subsection = detail?.subsection;
  const plotNumber = grave.plot?.plotNumber;

  return (
    <article className="grave-card-modern">
      {/* Landscape Photo Header */}
      <div className="grave-card-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="grave-card-photo"
          src={photo}
          alt={`Memorial photo for ${grave.deceasedName}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = FALLBACK_PHOTO;
          }}
        />
        {grave.status === "archived" && (
          <div style={{ position: "absolute", top: "0.75rem", right: "0.75rem", zIndex: 2 }}>
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 600,
                padding: "0.2rem 0.6rem",
                borderRadius: "9999px",
                background: "rgba(15, 23, 42, 0.75)",
                backdropFilter: "blur(8px)",
                color: "#e2e8f0",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Archived
            </span>
          </div>
        )}
      </div>

      {/* Card Content Body */}
      <div className="grave-card-body">
        <h2 className="grave-card-name">{grave.deceasedName}</h2>

        <div className="grave-card-meta-list">
          <p className="grave-card-location">
            <MapPin size={15} aria-hidden="true" />
            <span>{sectionName}</span>
          </p>

          <div className="grave-card-plot-meta">
            {subsection && <span className="grave-plot-pill">{subsection}</span>}
            {plotNumber && <span className="grave-plot-pill">Plot {plotNumber}</span>}
            {grave.tier && grave.tier > 1 && (
              <span className="grave-plot-pill">Tier {grave.tier}</span>
            )}
          </div>

          {burialDate && (
            <p className="grave-card-date">
              <Calendar size={14} aria-hidden="true" />
              <span>Buried {burialDate}</span>
            </p>
          )}
        </div>

        <div className="grave-card-footer">
          {grave.plot?.id ? (
            <Link
              href={`/kiosk?grave=${encodeURIComponent(grave.id)}`}
              className="btn btn-primary grave-action-btn"
              aria-label={`Open map route to ${grave.deceasedName}`}
            >
              <Navigation size={15} aria-hidden="true" />
              <span>Map Route</span>
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Location Pending
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Modern Compact List Grave Card
 */
function GraveCardList({ grave }) {
  const detail = grave.plot?.locationDetail;
  const photos = grave.plot?.photos || [];
  const photo =
    photos.find((p) => p.tier === grave.tier)?.url ||
    photos.find((p) => p.tier === 0)?.url ||
    FALLBACK_PHOTO;

  const burialDate = grave.burialDate
    ? new Date(grave.burialDate).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const sectionName = detail?.location?.name || "Bolonsiri Cemetery";
  const subsection = detail?.subsection;
  const plotNumber = grave.plot?.plotNumber;
  const plotLine = [subsection, plotNumber && `Plot ${plotNumber}`, grave.tier > 1 && `Tier ${grave.tier}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="grave-card-list">
      <div className="grave-card-list-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="grave-card-list-photo"
          src={photo}
          alt={`Photo of ${grave.deceasedName}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = FALLBACK_PHOTO;
          }}
        />
      </div>

      <div className="grave-card-list-details">
        {/* Name on the left, status pinned to the right edge */}
        <div className="grave-list-title">
          <h2 className="grave-list-name" title={grave.deceasedName}>
            {grave.deceasedName}
          </h2>
          {grave.status === "archived" && <span className="grave-list-status">Archived</span>}
        </div>

        <p className="grave-list-row grave-list-location" title={sectionName}>
          <MapPin size={13} aria-hidden="true" />
          <span>{sectionName}</span>
        </p>

        <p className="grave-list-row" title={plotLine || undefined}>
          <span>{plotLine || "Plot not assigned"}</span>
        </p>

        {/* Bottom row: burial date on the left, map route on the right */}
        <div className="grave-list-footer">
          <p className="grave-list-row grave-list-date">
            <Calendar size={13} aria-hidden="true" />
            <span>{burialDate ? `Buried ${burialDate}` : "Burial date not recorded"}</span>
          </p>
          {grave.plot?.id && (
            <Link
              href={`/kiosk?grave=${encodeURIComponent(grave.id)}`}
              className="btn btn-primary btn-sm grave-action-btn"
              aria-label={`Open map directions to ${grave.deceasedName}`}
            >
              <Navigation size={14} aria-hidden="true" />
              <span>Map Route</span>
              <ChevronRight size={15} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

function SearchPageContent() {
  const searchParams = useSearchParams();
  const queryParam = searchParams.get("q") ?? "";

  return <SearchPanel key={queryParam} initialQuery={queryParam} />;
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div
          className="public-page-wrapper"
          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div className="premium-bg-mesh" aria-hidden="true"></div>
          <div className="spinner spinner-lg" style={{ position: "relative", zIndex: 10 }} />
        </div>
      }
    >
      <SearchPageContent />
    </Suspense>
  );
}
