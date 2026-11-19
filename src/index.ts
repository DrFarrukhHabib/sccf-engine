import { Hono } from "hono";
import { analyst } from "./routes/analyst";

export type Bindings = { DB: D1Database; ANALYST_KEY: string; CMC_API_KEY?: string };
export const app = new Hono<{ Bindings: Bindings }>();
app.get("/health", (c) => c.json({ ok: true }));
app.route("/analyst", analyst);
export default app;
