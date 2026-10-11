"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const INTERVAL_MS = 7000;

// Camera moves for the photo on screen (keyframes in public.css). Each new
// slide gets a random one, never the same as the slide before it.
const MOTIONS = [
  "slideZoomIn",
  "slideZoomOut",
  "slidePanLeftToRight",
  "slidePanRightToLeft",
  "slidePanTopToBottom",
  "slidePanBottomToTop",
  "slideDriftDown",
  "slideDriftUp",
];

function randomMotion(...avoid) {
  const choices = MOTIONS.filter((motion) => !avoid.includes(motion));
  return choices[Math.floor(Math.random() * choices.length)];
}

// Next slide after `index`, skipping photos that failed to load.
function nextIndex(index, slides, failed) {
  for (let step = 1; step <= slides.length; step += 1) {
    const candidate = (index + step) % slides.length;
    if (!failed.has(slides[candidate])) return candidate;
  }
  return index;
}

/**
 * Full-page crossfading photo background that loops forever. Only the
 * previous, current and next slides are mounted, so the browser never
 * downloads the whole folder. A slide is only shown once its photo has
 * loaded, so a slow download holds the current photo instead of fading to
 * an empty background, and a broken photo is skipped.
 */
export function LandingSlideshow({ slides, visible = true }) {
  const [active, setActive] = useState(0);
  const [previous, setPrevious] = useState(null);
  const [failed, setFailed] = useState(() => new Set());
  // Motion per photo, picked when it comes on screen.
  const [motions, setMotions] = useState(() => ({ [slides[0]]: MOTIONS[0] }));
  const loaded = useRef(new Set());
  const count = slides.length;
  const upcoming = nextIndex(active, slides, failed);

  useEffect(() => {
    // Paused while faded out; resumes where it left off.
    if (!visible || upcoming === active) return undefined;
    const id = window.setInterval(() => {
      if (!loaded.current.has(slides[upcoming])) return;
      const incoming = slides[upcoming];
      setMotions((current) => ({
        ...current,
        // Differ from the outgoing photo, and from this photo's last move so
        // its animation restarts even when only two photos alternate.
        [incoming]: randomMotion(current[slides[active]], current[incoming]),
      }));
      setPrevious(active);
      setActive(upcoming);
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [active, upcoming, slides, visible]);

  if (!count) return null;

  const mounted = new Set([active, upcoming, previous]);
  const markFailed = (src) => setFailed((current) => new Set(current).add(src));

  return (
    <div className={`landing-slideshow ${visible ? "" : "is-hidden"}`} aria-hidden="true">
      {slides.map((src, index) =>
        mounted.has(index) && !failed.has(src) ? (
          <div
            key={src}
            className={`landing-slide ${
              index === active ? "is-active" : index === previous ? "is-previous" : ""
            }`}
            style={{ "--slide-motion": motions[src] || MOTIONS[0] }}
          >
            <Image
              src={src}
              alt=""
              fill
              sizes="100vw"
              loading="eager"
              fetchPriority={index === 0 ? "high" : "low"}
              className="landing-slide-img"
              onLoad={() => loaded.current.add(src)}
              onError={() => markFailed(src)}
            />
          </div>
        ) : null
      )}
      <div className="landing-slideshow-overlay" />
    </div>
  );
}
