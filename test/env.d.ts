declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ANALYST_KEY: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
