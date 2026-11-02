import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("answers 200 with ok: true", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("answers JSON", () => {
    expect(GET().headers.get("content-type")).toMatch(/application\/json/);
  });
});
