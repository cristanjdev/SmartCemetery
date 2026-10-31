import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// A production server (`next start`) serves only the files that were in
// public/ when the app was built, so photos uploaded later would 404. Requests
// that the static files did not answer land here and are read from disk.
const UPLOADS = path.join(process.cwd(), "public", "uploads");
const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export async function GET(_request, { params }) {
  const { path: parts } = await params;
  const file = path.resolve(UPLOADS, ...(parts || []));
  const type = TYPES[path.extname(file).slice(1).toLowerCase()];
  // Only image files inside public/uploads.
  if (!type || !file.startsWith(UPLOADS + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const data = await fs.promises.readFile(file);
    return new NextResponse(data, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(data.length),
        // Upload names are unique (timestamped), so a copy never goes stale.
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
