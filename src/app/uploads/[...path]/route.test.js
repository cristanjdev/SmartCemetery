import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GET } from "./route";

const DIR = path.join(process.cwd(), "public", "uploads", "graves");
const NAME = `zz-route-test-${Date.now()}.png`;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, NAME), PNG);
afterAll(() => fs.rmSync(path.join(DIR, NAME), { force: true }));

const get = (parts) => GET(new Request("http://x/uploads"), { params: Promise.resolve({ path: parts }) });

describe("GET /uploads/... (photos uploaded after the app was built)", () => {
  it("serves an uploaded photo with its image type", async () => {
    const res = await get(["graves", NAME]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("serves nothing outside public/uploads, and nothing that is not an image", async () => {
    expect((await get(["..", "..", "package.json"])).status).toBe(404);
    expect((await get(["..", "..", ".env.png"])).status).toBe(404);
    expect((await get(["graves", "missing.png"])).status).toBe(404);
    expect((await get(["graves", "notes.txt"])).status).toBe(404);
  });
});
