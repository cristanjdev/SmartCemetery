import { BLOCK_TYPES } from "@/lib/cemetery-layout";

/**
 * The printed directory's legend: what FBN, SBN, BBN, CB and UN stand for.
 * Its colours follow the theme (globals.css, .block-types).
 *
 * @param {{ inline?: boolean, wrap?: boolean }} props inline: one line (the map's
 *   bottom strip), wrapping unless `wrap` is false; else a list
 */
export default function BlockTypeLegend({ inline = false, wrap = true }) {
  return (
    <div
      aria-label="Block types"
      className={`block-types${inline ? " is-inline" : ""}${inline && !wrap ? " no-wrap" : ""}`}
    >
      <span className="block-types-title">Block types</span>
      {BLOCK_TYPES.map((t) => (
        <span key={t.code} className="block-types-item">
          <strong>{t.code}</strong> {t.name}
        </span>
      ))}
    </div>
  );
}
