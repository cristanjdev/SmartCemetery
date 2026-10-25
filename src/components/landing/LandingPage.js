"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, MapPinned, BookOpenText, ChartSpline, ChevronRight, User, Images, ImageOff } from "lucide-react";
import { PublicThemeToggle } from "@/components/ui/PublicThemeToggle";
import { SearchBar } from "@/components/ui/SearchBar";
import { LandingSlideshow } from "@/components/landing/LandingSlideshow";
import { SITE_NAME } from "@/lib/config";

const BACKGROUND_KEY = "landing-background";
const BACKGROUND_EVENT = "landing-background-change";
// The photo layer crossfades over FADE_MS; the light-on-glass colour scheme
// swaps partway through so text never sits on the wrong background.
const SCHEME_SWAP_MS = 380;

// The background choice lives in localStorage; plain is the default and
// the server render, so hydration never mismatches.
// Falls back to memory when storage is blocked, so the toggle still works.
let memoryBackground = "plain";

function readBackground() {
  try {
    const saved = localStorage.getItem(BACKGROUND_KEY);
    if (saved === "slideshow" || saved === "plain") return saved;
  } catch {
    // Storage unavailable (private mode, blocked site data).
  }
  return memoryBackground;
}

function subscribeBackground(onChange) {
  window.addEventListener(BACKGROUND_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(BACKGROUND_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const FEATURES = [
  {
    icon: MapPinned,
    title: "Interactive Map",
    description:
      "See exactly where a grave is on the cemetery map. The spot is marked for you, and the map shows you the way there, step by step.",
  },
  {
    icon: BookOpenText,
    title: "Smart Directory",
    description:
      "Look for a loved one by their name, grave number, or the year they were buried. Not sure how to spell the name? We will suggest names that sound the same.",
  },
  {
    icon: ChartSpline,
    title: "Data Insights",
    description:
      "Cemetery staff can see which grave spots are taken and which are still free, find records that are missing details, and count burials over time.",
  },
];

export function LandingPage({ slides = [] }) {
  const [query, setQuery] = useState("");
  const [isScrolled, setIsScrolled] = useState(false);
  const slideshowOn =
    useSyncExternalStore(subscribeBackground, readBackground, () => "plain") === "slideshow";
  const router = useRouter();
  const hasSlides = slides.length > 0;
  // During a switch, keep the previous colour scheme briefly (null = follow).
  const [schemeHold, setSchemeHold] = useState(null);
  // Once the slideshow has been shown, keep it mounted so it can fade out.
  const [photosMounted, setPhotosMounted] = useState(false);
  const swapTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(swapTimer.current), []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleBackground = () => {
    setPhotosMounted(true);
    setSchemeHold(slideshowOn);
    window.clearTimeout(swapTimer.current);
    swapTimer.current = window.setTimeout(() => setSchemeHold(null), SCHEME_SWAP_MS);

    memoryBackground = slideshowOn ? "plain" : "slideshow";
    try {
      localStorage.setItem(BACKGROUND_KEY, memoryBackground);
    } catch {
      // Preference just won't persist across visits.
    }
    window.dispatchEvent(new Event(BACKGROUND_EVENT));
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  const showSlideshow = hasSlides && slideshowOn;
  const slideshowScheme = hasSlides && (schemeHold ?? slideshowOn);

  // The landing page hides the browser scrollbar in every mode and theme
  // (the page still scrolls); other pages keep theirs.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("landing-no-scrollbar");
    return () => root.classList.remove("landing-no-scrollbar");
  }, []);
  const toggleLabel = showSlideshow ? "Show plain background" : "Show photo slideshow";

  return (
    <div className={`public-page-wrapper ${slideshowScheme ? "is-slideshow" : ""}`}>
      {/* Background: soft mesh, with the photo slideshow crossfading over it */}
      <div className="premium-bg-mesh"></div>
      {(showSlideshow || photosMounted) && hasSlides && (
        <LandingSlideshow slides={slides} visible={showSlideshow} />
      )}

      {/* Navigation */}
      <nav className={`premium-nav ${isScrolled ? "scrolled" : ""}`}>
        <Link href="/" className="premium-brand fade-in-up">
          <span>{SITE_NAME}</span>
        </Link>
        <div className="premium-nav-links fade-in-up delay-100">
          <Link href="/search" className="btn btn-ghost premium-nav-link" aria-label="Search Directory">
            <Search size={20} aria-hidden="true" />
            <span className="premium-nav-label">Search Directory</span>
          </Link>
          <PublicThemeToggle />
          <Link href="/login" className="btn btn-ghost premium-nav-icon" aria-label="Admin Login" title="Admin Login">
            <User size={20} />
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="premium-hero-content fade-in-up delay-200">
        <h1 className="premium-title">
          <span className="premium-title-highlight">Discover & Navigate</span>
        </h1>

        <p className="premium-subtitle">
          Experience the future of cemetery management. Digitalized burial records, interactive map navigation, smart search, and real-time monitoring tailored for seamless navigation.
        </p>

        <SearchBar
          value={query}
          onChange={setQuery}
          onSubmit={handleSearch}
          placeholder="Name, grave ID, or year"
          ariaLabel="Search records by name, ID, or year"
        />
      </div>

      {/* Features */}
      <section className="premium-features-grid fade-in-up delay-300" aria-label="Features">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <div key={title} className="premium-feature-card">
            <div className="premium-feature-header">
              <span className="premium-feature-icon">
                <Icon aria-hidden="true" />
              </span>
              <h3 className="premium-feature-title">{title}</h3>
            </div>
            <p className="premium-feature-desc">{description}</p>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer className="premium-footer fade-in-up delay-300">
        <p>© {new Date().getFullYear()} {SITE_NAME} Platform. A premium digital heritage project.</p>
      </footer>

      {hasSlides && (
        <button
          type="button"
          className="landing-bg-toggle"
          onClick={toggleBackground}
          aria-pressed={showSlideshow}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {showSlideshow ? <ImageOff size={20} aria-hidden="true" /> : <Images size={20} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
