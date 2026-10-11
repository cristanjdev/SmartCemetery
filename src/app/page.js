import { readdir } from "node:fs/promises";
import path from "node:path";
import { LandingPage } from "@/components/landing/LandingPage";

const SLIDESHOW_DIR = path.join(process.cwd(), "public", "slideshow");
const IMAGE_FILE = /\.(jpe?g|png|webp|avif)$/i;

// Any image dropped into public/slideshow becomes a landing slide.
async function getSlides() {
  try {
    const files = await readdir(SLIDESHOW_DIR);
    return files
      .filter((file) => IMAGE_FILE.test(file))
      .sort()
      .map((file) => `/slideshow/${encodeURIComponent(file)}`);
  } catch {
    return [];
  }
}

export default async function Home() {
  const slides = await getSlides();
  return <LandingPage slides={slides} />;
}
