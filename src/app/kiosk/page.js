"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Compass,
  LayoutGrid,
  MapPin,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import NavigationOverlay from "@/components/NavigationOverlay";
import { hasValidCoordinates } from "@/lib/navigation";
import { PublicThemeToggle } from "@/components/ui/PublicThemeToggle";
import { KIOSK_START_POINT, SITE_NAME } from "@/lib/config";

const CemeteryMap = dynamic(() => import("@/components/CemeteryMap"), {
  ssr: false,
  loading: () => <div className="spinner spinner-lg" aria-label="Loading cemetery map" />,
});

const FALLBACK_PHOTO = "/images/memorial_headstone.jpg";

function inactivityMilliseconds() {
  const configured = Number(process.env.NEXT_PUBLIC_KIOSK_INACTIVITY_SECONDS);
  const seconds =
    Number.isFinite(configured) && configured >= 10 && configured <= 3600
      ? configured
      : 120;
  return seconds * 1000;
}

// The kiosk map shows no status legend, so only the map-type control
// (top-left) needs clearance.
const KIOSK_ROUTE_FIT_PADDING = { top: 90, right: 60, bottom: 60, left: 60 };

function hasGps(plot) {
  return (
    plot?.gpsLat != null &&
    plot?.gpsLng != null &&
    Number.isFinite(Number(plot.gpsLat)) &&
    Number.isFinite(Number(plot.gpsLng))
  );
}

function uniqueResults(results) {
  const rows = [
    ...(results?.exact || []),
    ...(results?.suggestions || []),
    ...(results?.nearby || []),
  ];
  return rows.filter(
    (grave, index) => rows.findIndex((item) => item.id === grave.id) === index
  );
}

function KioskPanel({ initialGrave }) {
  const router = useRouter();
  // Opened for one grave (e.g. "Map route" from the directory): show a
  // full-screen map without the search header, plus a Back button.
  const focusMode = Boolean(initialGrave);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedGrave, setSelectedGrave] = useState(null);
  const [routeCoords, setRouteCoords] = useState(null);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const resetKiosk = useCallback(() => {
    setQuery("");
    setResults(null);
    setSelectedGrave(null);
    setRouteCoords(null);
    setError("");
    window.location.replace("/kiosk");
  }, []);

  // Inactivity auto-reset
  useEffect(() => {
    let timer;
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(resetKiosk, inactivityMilliseconds());
    };
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((event) => window.addEventListener(event, restart, { passive: true }));
    restart();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, restart));
    };
  }, [resetKiosk]);

  // Load initial grave if provided via URL param
  useEffect(() => {
    if (!initialGrave) return;
    let active = true;

    async function fetchInitialGrave() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/graves?q=${encodeURIComponent(initialGrave)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Search is temporarily unavailable.");
        if (!active) return;
        setResults(data);
        const rows = uniqueResults(data);
        const match = rows.find((g) => String(g.id) === String(initialGrave)) || rows[0];
        if (match) {
          setSelectedGrave(match);
          setQuery(match.deceasedName);
        }
      } catch (err) {
        if (!active) return;
        setError(err.message || "Failed to load memorial record.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchInitialGrave();
    return () => {
      active = false;
    };
  }, [initialGrave]);

  const allResults = useMemo(() => uniqueResults(results), [results]);

  const plots = useMemo(
    () =>
      allResults
        .filter((grave) => grave.plot)
        .map((grave) => ({
          ...grave.plot,
          status: grave.plot.status || "occupied",
          graves: [grave],
        }))
        .filter((plot, index, rows) => rows.findIndex((item) => item.id === plot.id) === index),
    [allResults]
  );

  const selectedPlot = selectedGrave?.plot || null;
  const destination = selectedPlot
    ? hasGps(selectedPlot)
      ? { lat: Number(selectedPlot.gpsLat), lng: Number(selectedPlot.gpsLng) }
      : { lat: Number.NaN, lng: Number.NaN }
    : null;

  const selectedPlacement = [
    selectedPlot?.locationDetail?.subsection,
    selectedPlot?.plotNumber && `Plot ${selectedPlot.plotNumber}`,
    selectedGrave?.tier > 1 && `Tier ${selectedGrave.tier}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const otherResults = useMemo(() => {
    if (!selectedGrave) return [];
    return allResults.filter((g) => g.id !== selectedGrave.id);
  }, [allResults, selectedGrave]);

  const handleSearch = async (event) => {
    if (event) event.preventDefault();
    const trimmed = String(query || "").trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    setRouteCoords(null);
    setSelectedGrave(null);
    try {
      const response = await fetch(`/api/graves?q=${encodeURIComponent(trimmed)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Search is temporarily unavailable.");
      setResults(data);
      const rows = uniqueResults(data);
      if (rows.length === 1) {
        setSelectedGrave(rows[0]);
        setQuery(rows[0].deceasedName);
      }
    } catch (err) {
      setResults(null);
      setError(err.message || "Search is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setQuery("");
    setResults(null);
    setSelectedGrave(null);
    setRouteCoords(null);
    setError("");
  };

  const selectGrave = (grave) => {
    setSelectedGrave(grave);
    setRouteCoords(null);
    if (grave?.deceasedName) {
      setQuery(grave.deceasedName);
    }
  };

  const goBack = () => {
    let sameOriginReferrer = false;
    try {
      sameOriginReferrer =
        Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin;
    } catch {
      sameOriginReferrer = false;
    }
    if (sameOriginReferrer && window.history.length > 1) router.back();
    else router.push("/search");
  };

  const photos = selectedPlot?.photos || [];
  const selectedPhoto =
    photos.find((p) => p.tier === selectedGrave?.tier)?.url ||
    photos.find((p) => p.tier === 0)?.url ||
    FALLBACK_PHOTO;

  const selectedBurialDate = selectedGrave?.burialDate
    ? new Date(selectedGrave.burialDate).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className={`public-page-wrapper kiosk-public-wrapper${focusMode ? " kiosk-focus" : ""}`}>
      <div className="premium-bg-mesh" aria-hidden="true" />

      {/* Top Public Navigation */}
      <nav className={`premium-nav kiosk-nav ${isScrolled ? "scrolled" : ""}`}>
        <Link href="/" className="premium-brand" aria-label={`${SITE_NAME} Home`}>
          <span>{SITE_NAME}</span>
        </Link>

        <div className="premium-nav-links">
          <Link
            href="/search"
            className="btn btn-ghost"
            style={{
              minHeight: "44px",
              minWidth: "44px",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0 0.85rem",
            }}
          >
            <Search size={18} aria-hidden="true" />
            <span className="kiosk-nav-label">Directory</span>
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={resetKiosk}
            title="Reset Kiosk"
            aria-label="Reset Kiosk"
            style={{
              minHeight: "44px",
              minWidth: "44px",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0 0.85rem",
            }}
          >
            <RotateCcw size={17} aria-hidden="true" />
            <span className="kiosk-nav-label">Reset</span>
          </button>
          <PublicThemeToggle />
        </div>
      </nav>

      {/* Kiosk Main Container */}
      <main className="kiosk-page-container">
        {/* Header with Search (hidden when opened for a single grave) */}
        {!focusMode && (
        <header className="kiosk-header">
          <h1 className="kiosk-title">Interactive Map &amp; Walking Route</h1>
          <p className="kiosk-subtitle">
            Search for a burial record to highlight the grave plot on the map and receive walking directions.
          </p>

          <form onSubmit={handleSearch} className="search-form-shell kiosk-search-form" role="search">
            <div className="search-input-group">
              <div className="search-input-field-wrapper">
                <div className="search-field-icon" aria-hidden="true">
                  <Search size={20} />
                </div>
                <input
                  id="kiosk-search-input"
                  type="text"
                  className="search-main-input"
                  autoComplete="off"
                  placeholder="Search by deceased name, ID, or plot number..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search records by name, ID, or plot"
                  autoFocus
                />
                {query.length > 0 && (
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
              <button
                id="kiosk-search-btn"
                type="submit"
                className="btn btn-primary search-submit-btn"
                disabled={loading}
                aria-label="Search"
              >
                <Search size={18} aria-hidden="true" />
                <span>{loading ? "Searching…" : "Search"}</span>
              </button>
            </div>
          </form>
        </header>
        )}

        {error && (
          <div role="alert" className="alert alert-danger" style={{ maxWidth: 840, margin: "0 auto 1.5rem" }}>
            {error}
          </div>
        )}

        {/* Workspace: Left Master-Detail Sidebar + Right Map Stage */}
        <div className="kiosk-workspace">
          {/* Left Column: Sidebar with Details & Actions */}
          <aside className="kiosk-sidebar" aria-label="Memorial Details and Navigation">
            {selectedGrave ? (
              /* Selected Memorial Card */
              <div className="kiosk-selected-card" data-testid="kiosk-selection">
                {/* Landscape Memorial Photo */}
                <div className="kiosk-card-media">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedPhoto}
                    alt={`Memorial photo for ${selectedGrave.deceasedName}`}
                    className="kiosk-card-photo"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = FALLBACK_PHOTO;
                    }}
                  />
                  <div className="kiosk-card-media-overlay">
                    <span className="kiosk-plot-pill">
                      Plot {selectedPlot?.plotNumber || "—"}
                    </span>
                    {selectedGrave.tier && selectedGrave.tier > 1 && (
                      <span className="kiosk-tier-pill">Tier {selectedGrave.tier}</span>
                    )}
                  </div>
                </div>

                {/* Content Body */}
                <div className="kiosk-card-body">
                  <h2 className="kiosk-card-name">{selectedGrave.deceasedName}</h2>

                  {/* One fact per row, same size, colour and icon column */}
                  <div className="kiosk-card-meta">
                    <p className="kiosk-card-meta-item kiosk-card-location">
                      <MapPin size={15} aria-hidden="true" />
                      <span>{selectedPlot?.locationDetail?.location?.name || "Bolonsiri Cemetery"}</span>
                    </p>
                    {selectedPlacement && (
                      <p className="kiosk-card-meta-item">
                        <LayoutGrid size={15} aria-hidden="true" />
                        <span>{selectedPlacement}</span>
                      </p>
                    )}
                    {selectedBurialDate && (
                      <p className="kiosk-card-meta-item">
                        <Calendar size={15} aria-hidden="true" />
                        <span>Buried {selectedBurialDate}</span>
                      </p>
                    )}
                  </div>

                  {/* Directions & Walking Navigation Panel — only for plots that
                      have GPS coordinates; others simply show no directions. */}
                  {hasValidCoordinates(destination) && (
                    <div className="kiosk-navigation-panel">
                      <NavigationOverlay
                        key={selectedGrave.id}
                        destination={destination}
                        onRouteChange={setRouteCoords}
                        plotId={selectedPlot?.id}
                        channel="kiosk"
                        fixedOrigin={KIOSK_START_POINT}
                        flat={true}
                      />
                    </div>
                  )}
                </div>

                {/* Other Matching Results Switcher */}
                {otherResults.length > 0 && (
                  <div className="kiosk-other-results">
                    <h3 className="kiosk-other-results-title">
                      Other Matching Records ({otherResults.length})
                    </h3>
                    <div className="kiosk-other-results-list">
                      {otherResults.map((grave) => (
                        <button
                          key={grave.id}
                          type="button"
                          className="kiosk-other-result-item"
                          onClick={() => selectGrave(grave)}
                        >
                          <div className="kiosk-other-result-info">
                            <span className="kiosk-other-result-name">{grave.deceasedName}</span>
                            <span className="kiosk-other-result-meta">
                              Plot {grave.plot?.plotNumber || "—"} ·{" "}
                              {grave.plot?.locationDetail?.subsection || "Section"}
                            </span>
                          </div>
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : allResults.length > 0 ? (
              /* Search Results List */
              <div className="kiosk-results-panel">
                <div className="kiosk-results-header">
                  <h2 className="kiosk-results-title">Search Results ({allResults.length})</h2>
                  <p className="kiosk-results-subtitle">Tap a record to highlight on map and get directions</p>
                </div>
                <div className="kiosk-results-list">
                  {allResults.map((grave) => (
                    <button
                      key={grave.id}
                      type="button"
                      className="kiosk-result-card"
                      onClick={() => selectGrave(grave)}
                    >
                      <div className="kiosk-result-icon">
                        <MapPin size={20} aria-hidden="true" />
                      </div>
                      <div className="kiosk-result-details">
                        <span className="kiosk-result-name">{grave.deceasedName}</span>
                        <span className="kiosk-result-meta">
                          Plot {grave.plot?.plotNumber || "—"} ·{" "}
                          {grave.plot?.locationDetail?.location?.name || "Cemetery"}
                        </span>
                      </div>
                      <ChevronRight size={18} className="kiosk-result-arrow" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ) : !loading && results && allResults.length === 0 ? (
              /* 0 Results */
              <div className="kiosk-empty-sidebar">
                <div className="kiosk-empty-icon" aria-hidden="true">
                  <Search size={32} />
                </div>
                <h2 className="kiosk-empty-title">No Records Found</h2>
                <p className="kiosk-empty-desc">
                  We could not find any cemetery records matching &ldquo;{query}&rdquo;.
                </p>
                <div style={{ marginTop: "1rem" }}>
                  <Link href="/search" className="btn btn-primary" style={{ minHeight: "44px" }}>
                    Browse Directory
                  </Link>
                </div>
              </div>
            ) : (
              /* Initial State */
              <div className="kiosk-empty-sidebar">
                <div className="kiosk-empty-icon" aria-hidden="true">
                  <Compass size={36} />
                </div>
                <h2 className="kiosk-empty-title">Ready to Navigate</h2>
                <p className="kiosk-empty-desc">
                  Search for a deceased relative or tap any plot directly on the cemetery map to view plot information and calculate walking routes.
                </p>
              </div>
            )}
          </aside>

          {/* Right Column: Dedicated Interactive Map Stage */}
          <section className="kiosk-map-stage" aria-label="Interactive Cemetery Map">
            <div className="kiosk-map-card" data-testid="kiosk-map">
              {/* Map Status Bar */}
              <div className="kiosk-map-header-bar">
                <div className="kiosk-map-status">
                  {focusMode && (
                    <button
                      type="button"
                      className="kiosk-map-back-btn"
                      onClick={goBack}
                      aria-label="Go back"
                      title="Go back"
                    >
                      <ArrowLeft size={16} aria-hidden="true" />
                      <span className="kiosk-map-back-label">Back</span>
                    </button>
                  )}
                  <span className="kiosk-map-eyebrow">
                    <span className="kiosk-map-dot" aria-hidden="true" />
                    {selectedPlot ? "Now viewing" : "Live map"}
                  </span>
                </div>
                <div className="kiosk-map-header-end">
                  <span className="kiosk-map-title">
                    {selectedPlot ? `Plot ${selectedPlot.plotNumber}` : "Interactive Cemetery Map"}
                  </span>
                  {selectedGrave && !focusMode && (
                    <button
                      type="button"
                      className="kiosk-map-recenter-btn"
                      onClick={() => {
                        setSelectedGrave(null);
                        setRouteCoords(null);
                      }}
                      title="Clear selection"
                    >
                      Clear Selection
                    </button>
                  )}
                </div>
              </div>

              {/* Map Viewport */}
              <div className="kiosk-map-viewport">
                <CemeteryMap
                  plots={plots}
                  selectedPlot={selectedPlot}
                  onSelectPlot={(plot) => {
                    const grave = allResults.find((item) => item.plot?.id === plot.id);
                    if (grave) selectGrave(grave);
                  }}
                  routeCoords={routeCoords}
                  routeFitPadding={KIOSK_ROUTE_FIT_PADDING}
                  focusPoint={hasGps(selectedPlot) ? destination : null}
                  showLegend={false}
                />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function KioskPageContent() {
  const searchParams = useSearchParams();
  const initialGrave = searchParams.get("grave") || "";

  return <KioskPanel key={initialGrave} initialGrave={initialGrave} />;
}

export default function KioskPage() {
  return (
    <Suspense
      fallback={
        <div
          className="public-page-wrapper"
          style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}
        >
          <div className="spinner spinner-lg" aria-label="Loading kiosk navigation" />
        </div>
      }
    >
      <KioskPageContent />
    </Suspense>
  );
}