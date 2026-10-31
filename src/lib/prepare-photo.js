/**
 * Gets a picked photo ready to upload, in the browser.
 *
 * Phone cameras save large photos (often 5–15 MB) and iPhones save HEIC by
 * default; the server takes JPEG, PNG, WebP or GIF up to 5 MB. A photo that is
 * too big, or in a format the server does not take, is redrawn as a JPEG no
 * wider or taller than MAX_SIDE_PX, which is plenty for a memorial photo. A
 * small JPEG/PNG/WebP/GIF is sent as it is.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_SIDE_PX = 2000;
const SERVER_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
/** What the file picker offers: the server's formats plus the phone formats this can convert. */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif";

function isHeic(file) {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || "");
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

/**
 * @param {File} file
 * @returns {Promise<{ ok: true, file: File } | { ok: false, error: string }>}
 */
export async function preparePhoto(file) {
  if (!file) return { ok: false, error: "No photo selected." };
  const fits = SERVER_TYPES.includes(file.type) && file.size <= MAX_UPLOAD_BYTES;
  if (fits) return { ok: true, file };

  let loaded;
  try {
    loaded = await loadImage(file);
  } catch {
    return {
      ok: false,
      error: isHeic(file)
        ? "This browser cannot open HEIC photos. Choose the photo from a phone or Safari, or save it as JPEG first."
        : "This file is not a photo that can be uploaded (use JPEG, PNG, WebP or GIF).",
    };
  }
  const { img, url } = loaded;
  try {
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // transparent areas of a PNG become white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob = null;
    for (const quality of [0.86, 0.75, 0.6]) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_UPLOAD_BYTES) break;
    }
    if (!blob || blob.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: "This photo is too large to upload, even after shrinking it." };
    }
    const name = (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
    return { ok: true, file: new File([blob], name, { type: "image/jpeg" }) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
