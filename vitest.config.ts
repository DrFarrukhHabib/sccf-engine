import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ANALYST_KEY: "test-analyst-key" }, d1Databases: ["RESTORE_DB"],
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
