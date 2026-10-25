"use client";

import { useSyncExternalStore } from "react";

/**
 * Google Maps calls the global `gm_authFailure()` when it rejects the API key
 * for the current page, most often because the key's website restrictions do
 * not list this address (RefererNotAllowedMapError, e.g. a new tunnel or
 * domain). Google then replaces the map with its own grey "Oops! Something
 * went wrong." box. This store records the failure so the map components can
 * show a plain explanation instead, and so the rest of the page keeps working.
 */
let authFailed = false;
const listeners = new Set();

function markFailed() {
  authFailed = true;
  listeners.forEach((listener) => listener());
}

/** Install the global callback once; keeps any handler set before ours. */
export function installMapsAuthFailureHandler(target = globalThis) {
  if (!target || target.__cemeteryMapsAuthHook) return;
  const previous = target.gm_authFailure;
  target.gm_authFailure = () => {
    markFailed();
    if (typeof previous === "function") previous();
  };
  target.__cemeteryMapsAuthHook = true;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True after Google Maps rejected the API key for this page. */
export function useMapsAuthFailed() {
  return useSyncExternalStore(
    subscribe,
    () => authFailed,
    () => false
  );
}

/** Test helper: forget a recorded failure. */
export function resetMapsAuthFailure() {
  authFailed = false;
}

export function isMapsAuthFailed() {
  return authFailed;
}
