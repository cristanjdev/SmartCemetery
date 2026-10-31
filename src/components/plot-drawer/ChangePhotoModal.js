"use client";

import { PHOTO_ACCEPT, preparePhoto } from "@/lib/prepare-photo";
import { useState } from "react";
import { toast } from "sonner";
import { X, Check, Camera } from "lucide-react";

/**
 * Modal to set or clear the photo of a plot tier (or every tier). Mounted only
 * while open, so its form state starts fresh each time.
 *
 * Saving posts to `/api/plots/:id/photo`, which returns the plot's photo rows;
 * the updated plot is passed to `onUpdatePlot`.
 */
export default function ChangePhotoModal({
  plot,
  currentTier,
  tierCount,
  ownTierPhoto,
  isLight,
  onUpdatePlot,
  onClose,
}) {
  const [photoModalTier] = useState(() => currentTier?.tier || 1);
  const [photoModalApplyToAll, setPhotoModalApplyToAll] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrlInput, setPhotoUrlInput] = useState(ownTierPhoto);
  const [photoPreview, setPhotoPreview] = useState(ownTierPhoto);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const handleFileChange = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    // Large phone photos and HEIC are shrunk to a JPEG first.
    const ready = await preparePhoto(picked);
    if (!ready.ok) {
      setPhotoError(ready.error);
      return;
    }
    const file = ready.file;
    setPhotoError("");
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSavePhoto = async () => {
    if (!plot) return;
    setUploadingPhoto(true);
    setPhotoError("");
    try {
      // Photos belong to a plot + tier, so this works for empty tiers too.
      const endpoint = `/api/plots/${plot.id}/photo`;

      let res;
      if (photoFile) {
        const fd = new FormData();
        fd.append("file", photoFile);
        if (photoModalTier != null) fd.append("tier", String(photoModalTier));
        if (photoModalApplyToAll) fd.append("applyToAll", "true");
        res = await fetch(endpoint, {
          method: "POST",
          body: fd,
        });
      } else {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photoUrl: photoUrlInput,
            tier: photoModalTier,
            applyToAll: photoModalApplyToAll,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update photo");
      }

      // The API returns the plot's photo rows after the change.
      const updatedPlot = { ...plot, photos: data.photos || [] };

      if (typeof onUpdatePlot === "function") {
        onUpdatePlot(updatedPlot);
      }
      onClose();
      toast.success(data.message || "Photo updated successfully");
    } catch (err) {
      console.error(err);
      setPhotoError(err.message || "Failed to save photo");
      toast.error(err.message || "Failed to save photo");
    } finally {
      setUploadingPhoto(false);
    }
  };

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
      onClick={() => !uploadingPhoto && onClose()}
    >
      <div
        style={{
          background: isLight ? "#ffffff" : "#0f172a",
          color: isLight ? "#0f172a" : "#f8fafc",
          border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: 12,
          padding: 20,
          maxWidth: 440,
          width: "100%",
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
                color: isLight ? "#0284c7" : "#38bdf8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Camera size={16} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>
                Change Profile Photo
              </h3>
              <p style={{ margin: 0, fontSize: "0.72rem", color: isLight ? "#64748b" : "#94a3b8" }}>
                {plot?.plotNumber} {currentTier?.label ? `• ${currentTier.label}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose()}
            disabled={uploadingPhoto}
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

        {/* Target Scope if multi-tier */}
        {tierCount > 1 && (
          <div
            style={{
              background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.04)",
              border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 8,
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontSize: "0.75rem",
            }}
          >
            <span style={{ fontWeight: 600, color: isLight ? "#475569" : "#cbd5e1" }}>
              Photo Assignment Scope:
            </span>
            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="photoScope"
                  checked={!photoModalApplyToAll}
                  onChange={() => setPhotoModalApplyToAll(false)}
                />
                <span>This Tier ({currentTier?.label || `Tier ${photoModalTier}`})</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="photoScope"
                  checked={photoModalApplyToAll}
                  onChange={() => setPhotoModalApplyToAll(true)}
                />
                <span>All Tiers / Entire Crypt</span>
              </label>
            </div>
          </div>
        )}

        {/* Preview Box */}
        <div
          style={{
            width: "100%",
            height: 160,
            borderRadius: 8,
            overflow: "hidden",
            border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.15)",
            background: isLight ? "#f1f5f9" : "#020617",
            position: "relative",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoPreview || "/images/memorial_headstone.jpg"}
            alt="Photo preview"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              e.currentTarget.src = "/images/memorial_headstone.jpg";
            }}
          />
          {photoPreview && photoPreview !== "/images/memorial_headstone.jpg" && (
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "rgba(0, 0, 0, 0.7)",
                color: "#ffffff",
                fontSize: "0.65rem",
                padding: "2px 8px",
                borderRadius: 12,
                fontWeight: 600,
              }}
            >
              Custom Photo Preview
            </div>
          )}
        </div>

        {/* File Upload Input */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: "0.74rem",
              fontWeight: 600,
              color: isLight ? "#475569" : "#cbd5e1",
              marginBottom: 6,
            }}
          >
            Upload from Device:
          </label>
          <input
            type="file"
            accept={PHOTO_ACCEPT}
            onChange={handleFileChange}
            disabled={uploadingPhoto}
            style={{
              fontSize: "0.75rem",
              width: "100%",
              padding: "6px 8px",
              borderRadius: 6,
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.15)",
              background: isLight ? "#f8fafc" : "#1e293b",
              color: isLight ? "#1e293b" : "#f8fafc",
            }}
          />
          <span style={{ fontSize: "0.67rem", color: isLight ? "#94a3b8" : "#64748b" }}>
            Supports JPG, PNG, WebP up to 5MB
          </span>
        </div>

        {/* Direct URL Input */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: "0.74rem",
              fontWeight: 600,
              color: isLight ? "#475569" : "#cbd5e1",
              marginBottom: 6,
            }}
          >
            Or Paste Image URL:
          </label>
          <input
            type="text"
            placeholder="https://example.com/photo.jpg or /images/..."
            value={photoUrlInput}
            onChange={(e) => {
              setPhotoFile(null);
              setPhotoUrlInput(e.target.value);
              setPhotoPreview(e.target.value);
            }}
            disabled={uploadingPhoto}
            style={{
              fontSize: "0.78rem",
              width: "100%",
              padding: "7px 10px",
              borderRadius: 6,
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.15)",
              background: isLight ? "#f8fafc" : "#1e293b",
              color: isLight ? "#1e293b" : "#f8fafc",
            }}
          />
        </div>

        {photoError && (
          <div style={{ color: "#ef4444", fontSize: "0.72rem", fontWeight: 600 }}>
            {photoError}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => {
              setPhotoFile(null);
              setPhotoUrlInput("");
              setPhotoPreview("/images/memorial_headstone.jpg");
            }}
            disabled={uploadingPhoto}
            style={{
              padding: "7px 12px",
              fontSize: "0.74rem",
              fontWeight: 600,
              borderRadius: 6,
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.15)",
              background: "transparent",
              color: isLight ? "#64748b" : "#94a3b8",
              cursor: "pointer",
            }}
          >
            Reset Default
          </button>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={() => onClose()}
            disabled={uploadingPhoto}
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
            onClick={handleSavePhoto}
            disabled={uploadingPhoto}
            style={{
              padding: "7px 16px",
              fontSize: "0.74rem",
              fontWeight: 700,
              borderRadius: 6,
              border: "none",
              background: "#0284c7",
              color: "#ffffff",
              cursor: uploadingPhoto ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 2px 6px rgba(2, 132, 199, 0.4)",
              opacity: uploadingPhoto ? 0.7 : 1,
            }}
          >
            <Check size={14} />
            <span>{uploadingPhoto ? "Saving..." : "Save Photo"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
