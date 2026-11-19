import { Hono } from "hono";
import { analyst } from "./routes/analyst";
import { createDesk } from "./routes/desk";
import { api } from "./routes/api";
import { runDaily } from "./jobs/daily";

export type Bindings = {
  DB: D1Database;
  ANALYST_KEY: string;
  CMC_API_KEY?: string;
  /** Cloudflare Access: team domain (x.cloudflareaccess.com), application audience tag, and the Scholar's email. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DESK_EMAIL?: string;
  /** R2 bucket for daily backups; until it exists the job reports that no backup was made. */
  BACKUPS?: R2Bucket;
  /** Service-account JSON and sheet for the Asset Register sync, until Najm reads the API. */
  GOOGLE_SA_JSON?: string;
  REGISTER_SHEET_ID?: string;
  REGISTER_TAB?: string;
};
export const app = new Hono<{ Bindings: Bindings }>();
app.get("/health", (c) => c.json({ ok: true }));
app.route("/analyst", analyst);
app.route("/desk", createDesk());
app.route("/v1", api);
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runDaily(env).then((r) => console.log(JSON.stringify({ job: "daily", ...r }))));
  },
} satisfies ExportedHandler<Bindings>;
