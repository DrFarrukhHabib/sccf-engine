// Usage: npx tsx scripts/import-catalog.ts <catalog.json> > catalog.sql
//        npx wrangler d1 execute sccf --remote --file catalog.sql
import { readFileSync } from "node:fs";
import { catalogToSql } from "../src/catalog/sql";

const path = process.argv[2];
if (!path) {
  console.error("Usage: import-catalog.ts <catalog.json>");
  process.exit(1);
}
process.stdout.write(catalogToSql(JSON.parse(readFileSync(path, "utf8"))));
