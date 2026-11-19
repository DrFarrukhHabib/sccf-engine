// Usage: npx tsx scripts/migrate-from-desk.ts <desk-export.json> > migrate.sql
//        npx wrangler d1 execute sccf --remote --file migrate.sql
// desk-export.json = { "tokens": [Review Desk tokens/<id> data], "history": [Review History rows, header first] }
import { readFileSync } from "node:fs";
import { deskToStatements, statementsToSql } from "../src/migrate/desk";

const path = process.argv[2];
if (!path) {
  console.error("Usage: migrate-from-desk.ts <desk-export.json>");
  process.exit(1);
}
const { statements, report } = deskToStatements(JSON.parse(readFileSync(path, "utf8")));
process.stdout.write(statementsToSql(statements));
console.error(JSON.stringify(report));
