import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../src/index";

describe("health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
