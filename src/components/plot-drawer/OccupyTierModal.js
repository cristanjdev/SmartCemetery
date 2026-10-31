"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { X, CheckCircle2, Check, Search, ChevronDown } from "lucide-react";

/**
 * Modal to move an existing grave record into the selected tier of a plot.
 * Mounted only while open, so its form state starts fresh each time.
 *
 * Patches `/api/graves/:id` with the destination plot/tier, then passes the
 * updated plot to `onUpdatePlot`.
 */
export default function OccupyTierModal({ plot, allPlots, currentTier, isLight, onUpdatePlot, onClose }) {
  const [selectedGraveId, setSelectedGraveId] = useState("");
  const [occupyError, setOccupyError] = useState("");
  const [occupying, setOccupying] = useState(false);
  const [occupySearchQuery, setOccupySearchQuery] = useState("");
  const [occupyDropdownOpen, setOccupyDropdownOpen] = useState(false);
  const occupyDropdownRef = useRef(null);

  // Close the searchable dropdown when clicking outside it.
  useEffect(() => {
    if (!occupyDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (occupyDropdownRef.current && !occupyDropdownRef.current.contains(e.target)) {
        setOccupyDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [occupyDropdownOpen]);

  const allGraves = [];
  const seenGraveIds = new Set();
  for (const p of allPlots) {
    for (const g of p.graves || []) {
      // Skip archived graves — they cannot be updated or transferred
      if (!g || !g.id || g.status === "archived") continue;
      // Skip if this grave is already sitting in this plot and this tier
      if (p.id === plot?.id && (g.tier || 1) === (currentTier?.tier || 1)) continue;
      if (seenGraveIds.has(g.id)) continue;
      seenGraveIds.add(g.id);
      allGraves.push({
        id: g.id,
        deceasedName: g.deceasedName,
        plotNumber: p.plotNumber,
        tier: g.tier || 1,
        status: g.status,
        burialDate: g.burialDate,
      });
    }
  }
  // Sort: vacant first, then by name
  allGraves.sort((a, b) => {
    const aOcc = a.status === "active" ? 1 : 0;
    const bOcc = b.status === "active" ? 1 : 0;
    if (aOcc !== bOcc) return aOcc - bOcc;
    return (a.deceasedName || "").localeCompare(b.deceasedName || "");
  });

  const selectedGrave = allGraves.find((g) => g.id === Number(selectedGraveId));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={() => {
        if (!occupying) {
          onClose();
        }
      }}
    >
      <div
        style={{
          background: isLight ? "#ffffff" : "#0f172a",
          color: isLight ? "#0f172a" : "#f8fafc",
          border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: 12,
          padding: "18px 20px",
          maxWidth: 440,
          width: "100%",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          boxSizing: "border-box",
          boxShadow: "0 20px 45px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: "auto",
                height: 32,
                color: isLight ? "#15803d" : "#86efac",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CheckCircle2 size={16} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>
                Occupy {currentTier?.label || `Tier ${currentTier?.tier}`}
              </h3>
              <p style={{ margin: 0, fontSize: "0.72rem", color: isLight ? "#64748b" : "#94a3b8" }}>
                {plot?.plotNumber} • Select a grave to assign
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
            }}
            disabled={occupying}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: isLight ? "#94a3b8" : "#64748b",
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Searchable Dropdown Container */}
        <div ref={occupyDropdownRef} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label
              style={{
                fontSize: "0.74rem",
                fontWeight: 600,
                color: isLight ? "#475569" : "#cbd5e1",
              }}
            >
              Select Grave <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <span style={{ fontSize: "0.68rem", color: isLight ? "#94a3b8" : "#64748b" }}>
              {allGraves.length} available to assign
            </span>
          </div>

          {/* Trigger input */}
          <div
            onClick={() => {
              if (!occupying) setOccupyDropdownOpen(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 8,
              border: occupyDropdownOpen
                ? isLight ? "1.5px solid #0284c7" : "1.5px solid #38bdf8"
                : isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.15)",
              background: isLight ? "#ffffff" : "#1e293b",
              cursor: occupying ? "default" : "pointer",
              boxShadow: occupyDropdownOpen
                ? (isLight ? "0 0 0 3px rgba(2, 132, 199, 0.15)" : "0 0 0 3px rgba(56, 189, 248, 0.15)")
                : "none",
              transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            }}
          >
            <Search size={14} style={{ color: isLight ? "#94a3b8" : "#64748b", flexShrink: 0 }} />
            <input
              type="text"
              value={
                occupyDropdownOpen
                  ? occupySearchQuery
                  : selectedGrave
                  ? `${selectedGrave.deceasedName} — Plot ${selectedGrave.plotNumber}, Tier ${selectedGrave.tier}`
                  : ""
              }
              onChange={(e) => {
                setOccupySearchQuery(e.target.value);
                if (!occupyDropdownOpen) setOccupyDropdownOpen(true);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!occupying) setOccupyDropdownOpen(true);
              }}
              onFocus={() => {
                if (!occupying) setOccupyDropdownOpen(true);
              }}
              placeholder="Search by name or plot..."
              disabled={occupying}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                outline: "none",
                fontSize: "0.82rem",
                color: isLight ? "#1e293b" : "#f8fafc",
                padding: 0,
                minWidth: 0,
              }}
            />
            {occupyDropdownOpen && occupySearchQuery && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOccupySearchQuery("");
                }}
                title="Clear search"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: isLight ? "#94a3b8" : "#64748b",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                  flexShrink: 0,
                }}
              >
                <X size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!occupying) setOccupyDropdownOpen((prev) => !prev);
              }}
              title={occupyDropdownOpen ? "Close list" : "Open list"}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: isLight ? "#64748b" : "#94a3b8",
                padding: 2,
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <ChevronDown
                size={15}
                style={{
                  transform: occupyDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              />
            </button>
          </div>

          {/* Dropdown list — in-flow so it never clips or overlaps buttons */}
          {occupyDropdownOpen && (
            <div
              style={{
                background: isLight ? "#ffffff" : "#1e293b",
                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: 8,
                boxShadow: isLight
                  ? "0 4px 14px rgba(0,0,0,0.06)"
                  : "0 4px 16px rgba(0,0,0,0.35)",
                maxHeight: 200,
                overflowY: "auto",
                overscrollBehavior: "contain",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {(() => {
                const q = occupySearchQuery.trim().toLowerCase();
                const filtered = q
                  ? allGraves.filter(
                      (g) =>
                        (g.deceasedName || "").toLowerCase().includes(q) ||
                        (g.plotNumber || "").toLowerCase().includes(q)
                    )
                  : allGraves;

                if (filtered.length === 0) {
                  return (
                    <div
                      style={{
                        padding: "16px 12px",
                        textAlign: "center",
                        color: isLight ? "#94a3b8" : "#64748b",
                        fontSize: "0.78rem",
                      }}
                    >
                      No graves found matching &ldquo;{occupySearchQuery}&rdquo;
                    </div>
                  );
                }

                return filtered.map((g) => {
                  const isSelected = g.id === Number(selectedGraveId);
                  const isOccupied = g.status === "active";
                  return (
                    <button
                      key={`occupy-grave-${g.id}`}
                      type="button"
                      onClick={() => {
                        setSelectedGraveId(String(g.id));
                        setOccupyDropdownOpen(false);
                        setOccupySearchQuery("");
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        padding: "9px 12px",
                        border: "none",
                        borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255, 255, 255, 0.05)",
                        background: isSelected
                          ? isLight
                            ? "#e0f2fe"
                            : "rgba(56, 189, 248, 0.18)"
                          : "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        gap: 10,
                        transition: "background 0.12s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.background = isLight ? "#f1f5f9" : "rgba(255,255,255,0.05)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.background = "transparent";
                        }
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: "0.82rem",
                            fontWeight: 600,
                            color: isSelected
                              ? (isLight ? "#0284c7" : "#38bdf8")
                              : (isLight ? "#1e293b" : "#f8fafc"),
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {g.deceasedName}
                        </div>
                        <div
                          style={{
                            fontSize: "0.71rem",
                            color: isLight ? "#64748b" : "#94a3b8",
                            marginTop: 2,
                          }}
                        >
                          Plot {g.plotNumber} • Tier {g.tier}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        {isOccupied && (
                          <span
                            style={{
                              fontSize: "0.62rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: isLight ? "#fef3c7" : "rgba(245, 158, 11, 0.2)",
                              color: isLight ? "#92400e" : "#fbbf24",
                              border: isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.3)",
                            }}
                          >
                            Transfer
                          </span>
                        )}
                        {isSelected && (
                          <Check
                            size={15}
                            style={{ color: isLight ? "#0284c7" : "#38bdf8" }}
                          />
                        )}
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
          )}

          <p style={{ margin: "2px 0 0", fontSize: "0.68rem", color: isLight ? "#94a3b8" : "#64748b" }}>
            Selecting an occupied grave will transfer it to this tier.
          </p>
        </div>

        {/* Selected grave preview */}
        {selectedGrave && (
          <div
            style={{
              background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.04)",
              border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: "0.78rem",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", color: isLight ? "#1e293b" : "#f8fafc" }}>
                {selectedGrave.deceasedName}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedGraveId("");
                  setOccupyDropdownOpen(true);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: isLight ? "#0284c7" : "#38bdf8",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Change
              </button>
            </div>
            <div style={{ color: isLight ? "#64748b" : "#94a3b8", fontSize: "0.73rem" }}>
              Currently: <strong>Plot {selectedGrave.plotNumber}</strong>, Tier {selectedGrave.tier}
            </div>
            <div style={{ color: isLight ? "#0284c7" : "#38bdf8", fontSize: "0.73rem" }}>
              Destination: <strong>Plot {plot?.plotNumber}</strong>, Tier {currentTier?.tier || 1}
            </div>
            {selectedGrave.status === "active" && (
              <div style={{ color: "#f59e0b", fontWeight: 600, fontSize: "0.72rem", marginTop: 2 }}>
                ⚠️ This grave is currently occupied and will be transferred.
              </div>
            )}
          </div>
        )}

        {occupyError && (
          <div
            style={{
              color: "#ef4444",
              fontSize: "0.72rem",
              fontWeight: 600,
              padding: "8px 10px",
              background: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.1)",
              borderRadius: 6,
              border: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.2)",
            }}
          >
            {occupyError}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 4, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => {
              onClose();
            }}
            disabled={occupying}
            style={{
              padding: "7px 14px",
              fontSize: "0.74rem",
              fontWeight: 600,
              borderRadius: 6,
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.15)",
              background: isLight ? "#f1f5f9" : "#1e293b",
              color: isLight ? "#1e293b" : "#f8fafc",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!selectedGraveId) {
                setOccupyError("Please select a grave");
                return;
              }
              setOccupying(true);
              setOccupyError("");
              try {
                const res = await fetch(`/api/graves/${selectedGraveId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    plotId: plot.id,
                    tier: currentTier?.tier || 1,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  throw new Error(data.error?.message || data.error || "Failed to transfer grave");
                }
                // Update local plot state
                const updatedPlot = JSON.parse(JSON.stringify(plot));
                if (!updatedPlot.graves) updatedPlot.graves = [];
                const tierNum = Number(data.tier) || Number(currentTier?.tier) || 1;
                updatedPlot.graves = updatedPlot.graves.filter(
                  (g) => (Number(g.tier) || 1) !== tierNum && g.id !== data.id
                );
                updatedPlot.graves.push({ ...data, tier: tierNum });
                updatedPlot.graves.sort((a, b) => (Number(a.tier) || 1) - (Number(b.tier) || 1));
                if (updatedPlot.status === "available") {
                  updatedPlot.status = "occupied";
                }
                if (typeof onUpdatePlot === "function") {
                  onUpdatePlot(updatedPlot);
                }
                onClose();
                toast.success(`${currentTier?.label || "Tier"} occupied successfully`);
              } catch (err) {
                console.error(err);
                setOccupyError(err.message || "Failed to occupy tier");
                toast.error(err.message || "Failed to occupy tier");
              } finally {
                setOccupying(false);
              }
            }}
            disabled={occupying || !selectedGraveId}
            style={{
              padding: "7px 16px",
              fontSize: "0.74rem",
              fontWeight: 700,
              borderRadius: 6,
              border: "none",
              background: selectedGrave?.status === "active" ? "#d97706" : "#16a34a",
              color: "#ffffff",
              cursor: occupying || !selectedGraveId ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: selectedGrave?.status === "active"
                ? "0 2px 6px rgba(217, 119, 6, 0.4)"
                : "0 2px 6px rgba(22, 163, 74, 0.4)",
              opacity: occupying || !selectedGraveId ? 0.7 : 1,
            }}
          >
            <CheckCircle2 size={14} />
            <span>
              {occupying
                ? "Transferring..."
                : selectedGrave?.status === "active"
                ? "Confirm Transfer"
                : "Occupy Tier"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );

}
