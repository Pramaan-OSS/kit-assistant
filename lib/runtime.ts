import { Pool } from "pg";
import { createAccounts } from "./accounts";
import { emailDoor } from "./email";

let sharedPool: Pool | undefined;
export function database() {
  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: integer("APP_DB_POOL_SIZE", 3),
      statement_timeout: 10000,
      connectionTimeoutMillis: integer("APP_DB_CONNECT_TIMEOUT_MS", 5000),
    });
    sharedPool.on("error", () => console.error("Account storage unavailable"));
  }
  return sharedPool;
}
let accounts: ReturnType<typeof createAccounts> | undefined;
const integer = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
};
export function accountRuntime() {
  if (accounts) return accounts;
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.SESSION_SECRET;
  if (!databaseUrl || !secret) throw new Error("Account storage has not been configured");
  const pool = database();
  accounts = createAccounts(pool, {
    secret,
    origin: process.env.APP_ORIGIN,
    projectId: process.env.PRAMAAN_PROJECT_ID,
    // Visitors here keep their own task lists. An owner-only product (a waitlist, say) sets false.
    publicSignUp: true,
    secureCookies: process.env.APP_COOKIE_SECURE !== "false",
    sessionSeconds: integer("APP_SESSION_SECONDS", 604800),
    passwordMinLength: integer("APP_PASSWORD_MIN_LENGTH", 12),
    maxBodyBytes: integer("APP_MAX_BODY_BYTES", 16384),
    taskTitleLength: integer("APP_TASK_TITLE_LENGTH", 240),
    authAttempts: integer("APP_AUTH_ATTEMPTS", 10),
    authClientAttempts: integer("APP_AUTH_CLIENT_ATTEMPTS", 30),
    authWindowSeconds: integer("APP_AUTH_WINDOW_SECONDS", 60),
    // #1177: sign-up confirmation links go through the platform's email module; with it off, none are sent.
    mailer: emailDoor,
  });
  return accounts;
}
