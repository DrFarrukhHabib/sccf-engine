declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    RESTORE_DB: D1Database;
    BACKUPS: R2Bucket;
    ANALYST_KEY: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
