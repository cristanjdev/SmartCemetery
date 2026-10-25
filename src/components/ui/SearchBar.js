"use client";

import { ChevronRight, Search, X } from "lucide-react";

/**
 * The visitor-facing search bar, shared by the landing page, the directory and
 * the kiosk so all three look and behave the same at every screen width.
 *
 * Styles live in `public.css` under `.premium-search-*`.
 */
export function SearchBar({
  value,
  onChange,
  onSubmit,
  onClear,
  placeholder,
  ariaLabel,
  inputId,
  buttonId,
  loading = false,
  autoFocus = false,
  className = "",
}) {
  return (
    <div className={`premium-search-container ${className}`.trim()}>
      {/* Chrome on iOS stamps its own autofill attributes on forms and inputs
          before React hydrates; ignore attribute differences on these two
          elements only. */}
      <form className="premium-search-form" role="search" onSubmit={onSubmit} suppressHydrationWarning>
        <div className="premium-search-field">
          <Search className="premium-search-icon" size={20} aria-hidden="true" />
          <input
            id={inputId}
            type="text"
            className="premium-search-input"
            suppressHydrationWarning
            autoComplete="off"
            placeholder={placeholder}
            aria-label={ariaLabel}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus={autoFocus}
          />
          {onClear && value.length > 0 && (
            <button
              type="button"
              className="premium-search-clear"
              onClick={onClear}
              aria-label="Clear search text"
              title="Clear"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <button id={buttonId} type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? (
            "Searching…"
          ) : (
            <>
              Locate <ChevronRight size={18} aria-hidden="true" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
