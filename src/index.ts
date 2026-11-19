import { Hono } from "hono";
import { analyst } from "./routes/analyst";
import { createDesk } from "./routes/desk";
import { api } from "./routes/api";

export type Bindings = {
  DB: D1Database;
  ANALYST_KEY: string;
  CMC_API_KEY?: string;
  /** Cloudflare Access: team domain (x.cloudflareaccess.com), application audience tag, and the Scholar's email. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DESK_EMAIL?: string;
};
export const app = new Hono<{ Bindings: Bindings }>();
app.get("/health", (c) => c.json({ ok: true }));
app.route("/analyst", analyst);
app.route("/desk", createDesk());
app.route("/v1", api);
export default app;
