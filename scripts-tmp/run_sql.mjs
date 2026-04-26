import { readFile } from "node:fs/promises";
import pg from "pg";

const sql = await readFile(process.argv[2] ?? "/tmp/ingest_v2.sql", "utf8");
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Connected. Running script in single transaction…");
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("✓ COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("✗ ROLLBACK:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
