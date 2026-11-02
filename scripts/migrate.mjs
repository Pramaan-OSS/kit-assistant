import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const tx = await db.connect();
try {
  await tx.query("BEGIN");
  await tx.query(
    "CREATE TABLE IF NOT EXISTS kit_migrations(name text PRIMARY KEY, digest text NOT NULL)",
  );
  const { createHash } = await import("node:crypto");
  const files = (await readdir("src/db/migrations")).filter((f) => /^\d+-.+\.sql$/.test(f)).sort();
  for (const name of files) {
    const sql = await readFile(`src/db/migrations/${name}`, "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    const old = await tx.query("SELECT digest FROM kit_migrations WHERE name=$1", [name]);
    if (old.rowCount) {
      if (old.rows[0].digest !== digest) throw new Error(`Migration changed: ${name}`);
      continue;
    }
    const last = await tx.query("SELECT name FROM kit_migrations ORDER BY name DESC LIMIT 1");
    if (last.rows[0]?.name > name) throw new Error(`Migration out of order: ${name}`);
    await tx.query(sql);
    await tx.query("INSERT INTO kit_migrations(name,digest) VALUES($1,$2)", [name, digest]);
  }
  await tx.query("COMMIT");
  console.log("Migrations applied.");
} catch (error) {
  await tx.query("ROLLBACK");
  throw error;
} finally {
  tx.release();
  await db.end();
}
