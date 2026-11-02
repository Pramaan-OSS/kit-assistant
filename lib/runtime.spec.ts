import { expect, it } from "vitest";

it("sizes the shared pool from the platform's APP_DB_POOL_SIZE", async () => {
  process.env.APP_DB_POOL_SIZE = "2";
  const { database } = await import("./runtime");
  const pool = database();
  expect(pool.options.max).toBe(2);
  await pool.end();
});
