/**
 * Placeholder while a map (2D or 3D) loads: fills the map's box and centres
 * a spinner with a short caption, in either theme.
 */
export default function MapLoading() {
  return (
    <div className="map-loading" role="status" aria-label="Loading cemetery map">
      <div className="spinner spinner-lg" aria-hidden="true" />
      <span className="map-loading-text">Loading map…</span>
    </div>
  );
}
