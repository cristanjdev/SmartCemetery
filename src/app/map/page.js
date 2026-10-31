"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useLiveLocation } from "@/components/useLiveLocation";
import { formatDistance } from "@/lib/live-location";
import MapLoading from "@/components/map/MapLoading";
import { hasValidCoordinates } from "@/lib/navigation";
import { PublicThemeToggle } from "@/components/ui/PublicThemeToggle";
import { SearchBar } from "@/components/ui/SearchBar";
import { KIOSK_START_POINT, SITE_NAME } from "@/lib/config";
import { tierLevelName, tierOccupancy } from "@/lib/plot-format";
import { buildingLabel, columnNumber, plotSide } from "@/lib/cemetery-layout";

const CemeteryMapView = dynamic(() => import("@/components/CemeteryMapView"), {
  ssr: false,
  loading: () => <MapLoading />,
});

// While a route is shown, the map header says where the visitor is: the
// text, a tone for the dot, and a longer explanation on hover.
function routeStatus(live) {
  switch (live.status) {
    case "arrived":
      return { tone: "done", text: "You've arrived at the plot", hint: "You are at the plot." };
    case "live":
      return {
        tone: "live",
        text: Number.isFinite(live.toPlotM) ? `On your way · ${formatDistance(live.toPlotM)} to go` : "On your way",
        hint: "Your position updates as you walk.",
      };
    case "away":
      return {
        tone: "wait",
        text: Number.isFinite(live.awayM)
          ? `Not at the cemetery yet · ${formatDistance(live.awayM)} away`
          : "Not at the cemetery yet",
        hint: "Your position will show once you reach the cemetery. Until then, You're here marks the start point.",
      };
    case "inaccurate":
      return { tone: "wait", text: "Weak GPS signal", hint: "Waiting for a more precise location; You're here marks the start point." };
    case "denied":
      return { tone: "off", text: "Location is off", hint: "Allow location access to follow your walk. You're here marks the start point." };
    case "unsupported":
      return { tone: "off", text: "Location not available", hint: "This browser cannot share its location." };
    default:
      return { tone: "wait", text: "Finding your location…", hint: "Waiting for your phone's location." };
  }
}

const FALLBACK_PHOTO = "/images/memorial_headstone.jpg";

// The kiosk map shows no status legend, so only the map-type control
// (top-left) needs clearance.
const KIOSK_ROUTE_FIT_PADDING = { top: 90, right: 60, bottom: 60, left: 60 };

// Below this width the map sits above the details, out of view once the
// visitor scrolls down to the directions.
const STACKED_LAYOUT_QUERY = "(max-width: 900px)";

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

function MapNavigatorPanel({ initialGrave }) {
  const router = useRouter();
  // Opened for one grave (e.g. "Map route" from the directory): show a
  // full-screen map without the search header, plus a Back button.
  const focusMode = Boolean(initialGrave);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedGrave, setSelectedGrave] = useState(null);
  // A plot chosen by tapping the map, with the graves found on it (none for a
  // vacant plot): shown as a plot card instead of a "no records" search.
  const [tappedPlot, setTappedPlot] = useState(null);
  const [tappedGraves, setTappedGraves] = useState([]);
  const [routeCoords, setRouteCoords] = useState(null);
  const startOver = useCallback(() => {
    setQuery("");
    setResults(null);
    setSelectedGrave(null);
    setRouteCoords(null);
    setError("");
    window.location.replace("/map");
  }, []);

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
  // Before any search: the side panel only holds the "Ready to Navigate" hint.
  const showIdlePanel = !selectedGrave && !tappedPlot && allResults.length === 0 && (loading || !results);

  // Every pinned plot's layout and occupied tiers (no names), so the map can
  // draw the whole cemetery with vacant and occupied tiers.
  const [layoutPlots, setLayoutPlots] = useState([]);
  useEffect(() => {
    let active = true;
    fetch("/api/plots/layout")
      .then((response) => (response.ok ? response.json() : { plots: [] }))
      .then((data) => {
        if (active && Array.isArray(data.plots)) setLayoutPlots(data.plots);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const plots = useMemo(() => {
    const byId = new Map(layoutPlots.map((plot) => [plot.id, plot]));
    for (const grave of allResults) {
      if (!grave.plot) continue;
      const base = byId.get(grave.plot.id);
      // A search result carries its own grave in full; the layout keeps the plot's other tiers.
      const others = (base?.graves || []).filter((g) => Number(g.tier) !== Number(grave.tier));
      byId.set(grave.plot.id, {
        ...base,
        ...grave.plot,
        status: grave.plot.status || base?.status || "occupied",
        graves: [...others, grave],
      });
    }
    return [...byId.values()];
  }, [layoutPlots, allResults]);

  const selectedPlot = selectedGrave?.plot || tappedPlot || null;
  const destination = selectedPlot
    ? hasGps(selectedPlot)
      ? { lat: Number(selectedPlot.gpsLat), lng: Number(selectedPlot.gpsLng) }
      : { lat: Number.NaN, lng: Number.NaN }
    : null;

  // While a route is on the map, the visitor's own GPS moves the walker —
  // once they are at the cemetery — and tells when they reach the plot.
  const live = useLiveLocation(Boolean(routeCoords), destination);

  const selectedPlacement = [
    selectedPlot?.locationDetail?.subsection,
    selectedPlot?.plotNumber && `Plot ${selectedPlot.plotNumber}`,
    selectedGrave?.tier > 1 && `Tier ${selectedGrave.tier}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // The tapped plot's tiers, and which face of its block it is.
  const tappedOccupancy = tappedPlot ? tierOccupancy(tappedPlot) : { occupied: 0, total: 0, tiers: [] };
  const tappedSide = plotSide(tappedPlot);

  const otherResults = useMemo(() => {
    if (!selectedGrave) return [];
    return allResults.filter((g) => g.id !== selectedGrave.id);
  }, [allResults, selectedGrave]);

  const handleSearch = (event) => {
    if (event) event.preventDefault();
    return runSearch(query);
  };

  const runSearch = async (term) => {
    const trimmed = String(term || "").trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    setRouteCoords(null);
    setSelectedGrave(null);
    setTappedPlot(null);
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
    setTappedPlot(null);
    setRouteCoords(null);
    setError("");
  };

  const selectGrave = (grave) => {
    setSelectedGrave(grave);
    setTappedPlot(null);
    setRouteCoords(null);
    if (grave?.deceasedName) {
      setQuery(grave.deceasedName);
    }
  };

  // Tapping a plot on the map shows that plot. Who rests there (if anyone) is
  // looked up by its plot number; a vacant plot simply shows its free tiers.
  const latestTap = useRef(null);
  const selectPlot = async (plot) => {
    const full = plots.find((p) => p.id === plot.id) || plot;
    latestTap.current = full;
    setSelectedGrave(null);
    setRouteCoords(null);
    setError("");
    setTappedPlot(full);
    setTappedGraves([]);
    if (!full?.plotNumber || tierOccupancy(full).occupied === 0) return;
    try {
      const response = await fetch(`/api/graves?q=${encodeURIComponent(full.plotNumber)}`);
      const data = await response.json().catch(() => ({}));
      // Ignore a lookup that comes back after the visitor tapped another plot.
      if (!response.ok || latestTap.current !== full) return;
      const here = uniqueResults(data).filter((g) => g.plot?.id === full.id);
      setTappedGraves(here.sort((a, b) => (a.tier || 1) - (b.tier || 1)));
    } catch {
      // The plot card still shows its tiers without names.
    }
  };

  // When a route appears on a stacked (phone) layout, bring the map back
  // into view so the visitor sees the path, not just the step list.
  const showRoute = useCallback((coords) => {
    setRouteCoords(coords);
    if (coords && window.matchMedia(STACKED_LAYOUT_QUERY).matches) {
      document
        .querySelector('[data-testid="kiosk-map"]')
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const walk = routeCoords ? routeStatus(live) : null;
  const mapStatus = walk ? (
    <span className={`kiosk-map-walk is-${walk.tone}`} title={walk.hint} role="status" aria-live="polite">
      <span className="kiosk-map-walk-dot" aria-hidden="true" />
      <span className="kiosk-map-walk-text">{walk.text}</span>
    </span>
  ) : (
    <span className="kiosk-map-eyebrow">
      <span className="kiosk-map-dot" aria-hidden="true" />
      {selectedPlot ? "Now viewing" : "Live map"}
    </span>
  );

  // Clears the chosen grave or plot (and its route); the map stays where it is.
  const clearSelection = () => {
    setSelectedGrave(null);
    setTappedPlot(null);
    setRouteCoords(null);
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
      {/* Always the solid "scrolled" bar: on big screens this page fits the
          screen and never scrolls, so the bar would otherwise never show. */}
      <nav className="premium-nav kiosk-nav scrolled">
        <Link href="/" className="premium-brand" aria-label={`${SITE_NAME} Home`}>
          <span>{SITE_NAME}</span>
        </Link>

        <div className="premium-nav-links">
          <Link href="/search" className="btn btn-ghost premium-nav-link" aria-label="Directory">
            <Search size={20} aria-hidden="true" />
            <span className="premium-nav-label">Directory</span>
          </Link>
          <button
            type="button"
            className="btn btn-ghost premium-nav-link"
            onClick={startOver}
            title="Start over"
            aria-label="Start over"
          >
            <RotateCcw size={20} aria-hidden="true" />
            <span className="premium-nav-label">Reset</span>
          </button>
          <PublicThemeToggle />
        </div>
      </nav>

      {/* Kiosk Main Container */}
      <main className="kiosk-page-container">
        {/* Header with Search (hidden when opened for a single grave) */}
        {!focusMode && (
        <header className="kiosk-header">
          <div className="kiosk-header-text">
            <h1 className="kiosk-title">Interactive Map &amp; Walking Route</h1>
            <p className="kiosk-subtitle">
              Search for a burial record to highlight the grave plot on the map and receive walking directions.
            </p>
          </div>

          <SearchBar
            className="search-bar-spaced"
            inputId="kiosk-search-input"
            buttonId="kiosk-search-btn"
            value={query}
            onChange={setQuery}
            onSubmit={handleSearch}
            onClear={handleClear}
            loading={loading}
            placeholder="Name, grave ID, or plot"
            ariaLabel="Search records by name, ID, or plot"
            autoFocus
          />
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
          <aside
            className={`kiosk-sidebar${showIdlePanel ? " kiosk-sidebar-idle" : ""}`}
            aria-label="Memorial Details and Navigation"
          >
            {selectedGrave ? (
              /* Selected Memorial Card */
              <div className="kiosk-selected-card" data-testid="kiosk-selection">
                {/* Landscape Memorial Photo */}
                <div className="kiosk-card-media">
                  {!focusMode && (
                    <button
                      type="button"
                      className="kiosk-card-clear"
                      onClick={clearSelection}
                      aria-label="Clear selection"
                      title="Clear selection"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}
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
                      have GPS coordinates; others say why there is no route. */}
                  {!hasValidCoordinates(destination) && (
                    <p className="kiosk-card-note" role="note">
                      This plot is not on the map yet, so walking directions are not available. Please ask at
                      the CMP Admin Office.
                    </p>
                  )}
                  {hasValidCoordinates(destination) && (
                    <div className="kiosk-navigation-panel">
                      <NavigationOverlay
                        key={selectedGrave.id}
                        destination={destination}
                        onRouteChange={showRoute}
                        plotId={selectedPlot?.id}
                        channel="kiosk"
                        fixedOrigin={KIOSK_START_POINT}
                        flat={true}
                        hideTitle
                        showDetails={false}
                        // Opened from "Map Route": the route is drawn straight away.
                        autoStart={focusMode && String(selectedGrave.id) === String(initialGrave)}
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
            ) : tappedPlot ? (
              /* A plot tapped on the map (vacant or not): its facts, niche stack and directions */
              <div className="kiosk-selected-card" data-testid="map-plot-selection">
                <header className="plot-card-head">
                  <h2 className="plot-card-title">{tappedPlot.plotNumber}</h2>
                  {!focusMode && (
                    <button
                      type="button"
                      className="plot-card-clear"
                      onClick={clearSelection}
                      aria-label="Clear selection"
                      title="Clear selection"
                    >
                      <X size={15} aria-hidden="true" />
                      <span>Clear</span>
                    </button>
                  )}
                </header>

                <dl className="plot-card-facts">
                  {tappedPlot.locationDetail?.subsection && (
                    <div className="plot-card-fact">
                      <dt>Block</dt>
                      <dd>{buildingLabel(tappedPlot.locationDetail.subsection).replace(/^Row\s+/i, "")}</dd>
                    </div>
                  )}
                  {tappedSide && (
                    <div className="plot-card-fact">
                      <dt>Side</dt>
                      <dd>{tappedSide === "A" ? "Front" : "Back"}</dd>
                    </div>
                  )}
                  {columnNumber(tappedPlot) > 0 && (
                    <div className="plot-card-fact">
                      <dt>Column</dt>
                      <dd>{columnNumber(tappedPlot)}</dd>
                    </div>
                  )}
                </dl>

                {tappedOccupancy.total > 0 && (
                  <section className="plot-card-section plot-card-section-niches" aria-label="Niches in this plot">
                    <h3 className="plot-card-section-title">
                      <span>Niches</span>
                      <span className="plot-card-count">
                        {tappedOccupancy.occupied === 0
                          ? "All vacant"
                          : tappedOccupancy.occupied === tappedOccupancy.total
                          ? "All occupied"
                          : `${tappedOccupancy.occupied} of ${tappedOccupancy.total} occupied`}
                      </span>
                    </h3>

                    {tappedOccupancy.total > 1 && (
                      <div className="plot-card-meter" aria-hidden="true">
                        {[...tappedOccupancy.tiers].reverse().map((occupied, i) => (
                          <span key={i} className={`plot-card-meter-seg${occupied ? " is-occupied" : ""}`} />
                        ))}
                      </div>
                    )}

                    {/* Top tier first, as the niches stand on site */}
                    <ul className="plot-card-tiers">
                      {tappedOccupancy.tiers
                        .map((occupied, i) => ({ tier: i + 1, occupied }))
                        .reverse()
                        .map(({ tier, occupied }) => {
                          const grave = tappedGraves.find((g) => Number(g.tier) === tier);
                          const body = (
                            <>
                              <span className="plot-card-tier-swatch" aria-hidden="true" />
                              <span className="plot-card-tier-name">
                                <span className="plot-card-tier-label">
                                  {tappedOccupancy.total > 1 ? `Tier ${tier}` : "Burial lot"}
                                </span>
                                {tappedOccupancy.total > 1 && (
                                  <span className="plot-card-tier-level">
                                    {tierLevelName(tier, tappedOccupancy.total)}
                                  </span>
                                )}
                              </span>
                              <span className="plot-card-tier-state">
                                {grave ? grave.deceasedName : occupied ? "Occupied" : "Vacant"}
                                {grave && <ChevronRight size={16} aria-hidden="true" />}
                              </span>
                            </>
                          );
                          return (
                            <li key={tier} className={`plot-card-tier ${occupied ? "is-occupied" : "is-vacant"}`}>
                              {grave ? (
                                <button
                                  type="button"
                                  className="plot-card-tier-row"
                                  onClick={() => selectGrave(grave)}
                                  aria-label={`Tier ${tier}, ${grave.deceasedName}. Open this record.`}
                                >
                                  {body}
                                </button>
                              ) : (
                                <div className="plot-card-tier-row">{body}</div>
                              )}
                            </li>
                          );
                        })}
                    </ul>
                  </section>
                )}

                {hasValidCoordinates(destination) && (
                  <section className="plot-card-section plot-card-section-directions" aria-label="Directions">
                    <NavigationOverlay
                      key={`plot-${tappedPlot.id}`}
                      destination={destination}
                      onRouteChange={showRoute}
                      plotId={tappedPlot.id}
                      channel="kiosk"
                      fixedOrigin={KIOSK_START_POINT}
                      hideTitle
                      flat
                      showDetails={false}
                    />
                  </section>
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
                  {!focusMode && mapStatus}
                </div>
                <div className="kiosk-map-header-end">
                  {/* Opened for one grave: Back on the left, the status on the right. */}
                  {focusMode && mapStatus}
                  {!selectedPlot && <span className="kiosk-map-title kiosk-map-title-generic">Interactive Cemetery Map</span>}
                </div>
              </div>

              {/* Map Viewport */}
              <div className="kiosk-map-viewport">
                <CemeteryMapView
                  plots={plots}
                  selectedPlot={selectedPlot}
                  onSelectPlot={(plot) => {
                    const grave = allResults.find((item) => item.plot?.id != null && item.plot.id === plot.id);
                    if (grave) {
                      selectGrave(grave);
                    } else if (plot?.id != null) {
                      // Any other plot, vacant or not: show the plot itself.
                      void selectPlot(plot);
                    }
                  }}
                  routeCoords={routeCoords}
                  routeFitPadding={KIOSK_ROUTE_FIT_PADDING}
                  focusPoint={hasGps(selectedPlot) ? destination : null}
                  showLegend={false}
                  showStatus
                  showYouAreHere
                  userPosition={live.position}
                />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function MapNavigatorContent() {
  const searchParams = useSearchParams();
  const initialGrave = searchParams.get("grave") || "";

  return <MapNavigatorPanel key={initialGrave} initialGrave={initialGrave} />;
}

export default function MapNavigatorPage() {
  return (
    <Suspense
      fallback={
        <div
          className="public-page-wrapper"
          style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}
        >
          <div className="spinner spinner-lg" aria-label="Loading the map navigator" />
        </div>
      }
    >
      <MapNavigatorContent />
    </Suspense>
  );
}