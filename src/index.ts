import { Hono } from "hono";

export type Bindings = { DB: D1Database; ANALYST_KEY: string };
export const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true }));

export default app;
