import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Pool } from "pg";
import type { Mailer } from "./email";

// The owner has no email until they choose one in the owner area.
export type User = { id: string; email: string | null; role: string };
type Database = Pick<Pool, "query">;
export type AccountConfig = {
  secret: string;
  secureCookies: boolean;
  origin?: string;
  // The project Pramaan's owner pass must name (PRAMAAN_PROJECT_ID); no pass opens an app without it.
  projectId?: string;
  // Whether visitors may sign up (as members; true unless set). An owner-only product sets false and has no
  // sign-up page.
  publicSignUp?: boolean;
  sessionSeconds: number;
  passwordMinLength: number;
  maxBodyBytes: number;
  taskTitleLength: number;
  authAttempts: number;
  authClientAttempts: number;
  authWindowSeconds: number;
  // #1177: how a sign-up's confirmation link is sent (lib/email.ts). None: no email, so every account stays unverified.
  mailer?: Mailer;
};
export class AccountError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
// With Secure cookies the session is a __Host- cookie (Secure, Path=/, no Domain): an app on a sibling
// host under the same parent domain cannot set or shadow it. Plain HTTP keeps the unprefixed name.
const COOKIE = "app_session";
const HOST_COOKIE = `__Host-${COOKIE}`;
// Attempts at one email from every client together, as a multiple of authAttempts (one email, one client).
const ACCOUNT_CEILING = 5;

/** The first 64 bits of an IPv6 address, the block one host is usually given. */
function prefix64(address: string) {
  const [head = "", tail] = (address.split("%")[0] ?? "").split("::");
  const groups = (part = "") => (part === "" ? [] : part.split(":"));
  const left = groups(head);
  const right = groups(tail);
  const width = [...left, ...right].reduce((n, group) => n + (group.includes(".") ? 2 : 1), 0);
  const zeros = tail === undefined ? [] : new Array<string>(8 - width).fill("0");
  return [...left, ...zeros, ...right]
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":");
}

/**
 * The client a request came from, for throttling. Caddy (ops/caddy/pramaan-hosting.caddy) sets
 * X-Forwarded-For to the address it accepted the connection from and, with no trusted_proxies, drops
 * whatever the browser sent; the app's port is published on loopback only, so outside requests all
 * come through it. With nothing in front, Next sets the header from its own socket. Only the last
 * entry, the nearest proxy's, is read. An IPv6 host counts by its /64; anything else is "unknown".
 */
export function clientOf(request: Request): string {
  const last = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "";
  const address = last.replace(/^::ffff:(?=\d{1,3}(?:\.\d{1,3}){3}$)/iu, "");
  if (isIP(address) === 4) return address;
  if (isIP(address) === 6) return `${prefix64(address.toLowerCase())}::/64`;
  return "unknown";
}
let passwordWork = 0;
async function derive(password: string, salt: string): Promise<Buffer> {
  if (passwordWork >= 4) throw new AccountError(429, "Please wait a moment and try again.");
  passwordWork++;
  try {
    return await new Promise((resolve, reject) =>
      scrypt(
        password,
        salt,
        64,
        { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      ),
    );
  } finally {
    passwordWork--;
  }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [, salt, hex] = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/u.exec(encoded) ?? [];
  if (!salt || !hex) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hex, "hex"));
}
const DUMMY_PASSWORD = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;
/** How long an email confirmation link works. */
const VERIFY_SECONDS = 86400;
/** How long a password reset link works. */
const RESET_SECONDS = 3600;
// The same answer whether or not the address has an account: the answer never tells anyone who has one.
const RESET_ANSWER = "If that address has an account, we've sent a link.";
const RESET_REFUSED = "This reset link has expired or was already used. Ask for a new one.";
/** Where Pramaan's owner pass signs the owner in to. */
export const OWNER_AREA = "/owner";
const OWNER_PASS_SECONDS = 60;
const PASS_REFUSED =
  "This owner link has expired or was already used. Open the app as its owner from Pramaan again.";

/**
 * Pramaan's owner pass: how the app learns who owns it. Never the first account to sign up, never a role a
 * browser asks for. The pass is `<payload>.<signature>` (base64url), signed with HMAC-SHA256 under the app's
 * SESSION_SECRET over "pramaan-owner-pass.v1." + payload; the payload is JSON { v: 1, project, role: "owner",
 * iat, exp, nonce } in whole seconds. Its claims when genuine, for this project and unexpired; otherwise null.
 * Single use is the caller's: it records the nonce.
 */
export function readOwnerPass(
  token: string,
  secret: string,
  projectId: string | undefined,
  now = Date.now(),
) {
  if (!projectId || !/^[A-Za-z0-9_-]{1,1024}\.[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  const [body = "", signature = ""] = token.split(".");
  const expected = createHmac("sha256", secret).update(`pramaan-owner-pass.v1.${body}`).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const seconds = Math.floor(now / 1000);
  const { iat, exp, nonce } = claims ?? {};
  if (
    claims?.v !== 1 ||
    claims.role !== "owner" ||
    claims.project !== projectId ||
    typeof nonce !== "string" ||
    !/^[A-Za-z0-9_-]{16,64}$/u.test(nonce) ||
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(exp) ||
    (exp as number) <= seconds ||
    (exp as number) - (iat as number) > OWNER_PASS_SECONDS ||
    (iat as number) > seconds + 5
  )
    return null;
  return { nonce, exp: exp as number };
}

export function createAccounts(db: Database, config: AccountConfig) {
  if (config.secret.length < 32)
    throw new Error("SESSION_SECRET must be configured by the runtime");
  if (
    ![
      config.sessionSeconds,
      config.passwordMinLength,
      config.maxBodyBytes,
      config.taskTitleLength,
      config.authAttempts,
      config.authClientAttempts,
      config.authWindowSeconds,
    ].every((value) => Number.isSafeInteger(value) && value > 0)
  )
    throw new Error("Invalid account runtime configuration");
  const digest = (token: string) => createHmac("sha256", config.secret).update(token).digest("hex");
  const name = config.secureCookies ? HOST_COOKIE : COOKIE;
  const tokenOf = (request: Request) => {
    const token = request.headers
      .get("cookie")
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    return token && /^[a-f0-9]{64}$/u.test(token) ? token : null;
  };
  const cookie = (token: string, maxAge = config.sessionSeconds) =>
    `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? "; Secure" : ""}`;
  // One attempt against a throttle key, counted in the current window; how many it has seen.
  async function attempt(key: string) {
    const throttle = await db.query<{ attempts: number }>(
      `INSERT INTO app_auth_throttle(key,attempts,started_at)
      VALUES($1,1,now()) ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN app_auth_throttle.started_at<now()-$2*interval '1 second' THEN 1 ELSE app_auth_throttle.attempts+1 END,
      started_at=CASE WHEN app_auth_throttle.started_at<now()-$2*interval '1 second' THEN now() ELSE app_auth_throttle.started_at END
      RETURNING attempts`,
      [digest(key), config.authWindowSeconds],
    );
    return throttle.rows[0]?.attempts ?? Number.POSITIVE_INFINITY;
  }
  // Three counts a window, each asked only when the one before allowed the attempt, so a refused
  // attempt never counts against anyone else: the client across every email (no spraying), this
  // email from this client (guessing from one place), and this email from every client (a ceiling
  // for guesses spread over many). One client adds at most twice authAttempts to the last in any
  // window, so on its own it can never lock the account out for its owner signing in elsewhere.
  async function throttled(email: string, client: string) {
    return (
      (await attempt(`client ${client}`)) > config.authClientAttempts ||
      (await attempt(`email ${email} ${client}`)) > config.authAttempts ||
      (await attempt(`account ${email}`)) > config.authAttempts * ACCOUNT_CEILING
    );
  }
  const json = (value: unknown, status = 200, session?: string) =>
    Response.json(value, {
      status,
      headers: { "cache-control": "no-store", ...(session ? { "set-cookie": session } : {}) },
    });
  async function requireUser(request: Request): Promise<User> {
    const token = tokenOf(request);
    if (!token) throw new AccountError(401, "Sign in to continue.");
    const result = await db.query<User>(
      `SELECT u.id,u.email,u.role FROM app_sessions s JOIN app_users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [digest(token)],
    );
    const user = result.rows[0];
    if (!user) throw new AccountError(401, "Your session has ended. Sign in again.");
    const expectedUser = request.headers.get("x-app-user");
    if (expectedUser && expectedUser !== user.id)
      throw new AccountError(409, "Your account changed. Refresh before continuing.");
    return user;
  }
  async function requireRole(request: Request, roles: string[]) {
    const user = await requireUser(request);
    if (!roles.includes(user.role))
      throw new AccountError(403, "You do not have access to this action.");
    return user;
  }
  async function body(request: Request): Promise<Record<string, unknown>> {
    const origin = config.origin ?? new URL(request.url).origin;
    if (request.headers.get("origin") !== origin)
      throw new AccountError(403, "Refresh this page and try again.");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AccountError(415, "Send JSON.");
    const reader = request.body?.getReader();
    if (!reader) throw new AccountError(400, "A request body is required.");
    const parts: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > config.maxBodyBytes) {
          await reader.cancel();
          throw new AccountError(413, "This request is too large.");
        }
        parts.push(next.value);
      }
      const value: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error("object expected");
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof AccountError) throw error;
      throw new AccountError(400, "Check the submitted information.");
    } finally {
      reader.releaseLock();
    }
  }
  async function startSession(userId: string) {
    const token = randomBytes(32).toString("hex");
    await db.query("DELETE FROM app_sessions WHERE expires_at<=now() AND user_id=$1", [userId]);
    await db.query(
      "INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3*interval '1 second')",
      [digest(token), userId, config.sessionSeconds],
    );
    return cookie(token);
  }
  async function signedIn(user: User) {
    return json({ user }, 200, await startSession(user.id));
  }
  // #1177: one link per account at a time, for the address it is sent to. True when the door took it.
  async function sendVerification(user: { id: string; email: string | null }, origin: string) {
    if (!config.mailer || !user.email) return false;
    const token = randomBytes(32).toString("hex");
    await db.query("DELETE FROM app_email_verifications WHERE user_id=$1 OR expires_at<now()", [
      user.id,
    ]);
    await db.query(
      "INSERT INTO app_email_verifications(token_hash,user_id,email,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 second')",
      [digest(token), user.id, user.email, VERIFY_SECONDS],
    );
    const link = `${origin}/api/account/verify?token=${token}`;
    const sent = await config.mailer.send(
      {
        to: user.email,
        subject: "Confirm your email address",
        text: `Open this link to confirm this is your email address:\n\n${link}\n\nIt works once, for a day. If you did not ask for this, you can ignore this email.`,
      },
      `verify-${digest(token).slice(0, 40)}`,
    );
    return sent.status === "sent";
  }
  // Sent after the answer: a slow email service never holds up signing up.
  const verifyLater = (user: { id: string; email: string | null }, origin: string) =>
    void sendVerification(user, origin).catch(() =>
      console.error("Email confirmation could not be sent"),
    );
  /** #1177: an account's email once its owner has confirmed it, else null. Send nothing to any other address. */
  async function verifiedEmail(userId: string) {
    const result = await db.query<{ email: string }>(
      "SELECT email FROM app_users WHERE id=$1 AND email IS NOT NULL AND email_verified_at IS NOT NULL",
      [userId],
    );
    return result.rows[0]?.email ?? null;
  }
  // #1250: a reset link, only to an account's verified address; a new one replaces the account's last.
  async function sendReset(email: string, origin: string) {
    if (!config.mailer) return;
    const user = (
      await db.query<{ id: string }>("SELECT id FROM app_users WHERE email=$1", [email])
    ).rows[0];
    const to = user && (await verifiedEmail(user.id));
    if (!user || !to) return;
    const token = randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO app_password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3*interval '1 second')
      ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at`,
      [digest(token), user.id, RESET_SECONDS],
    );
    const link = `${origin}/reset-password?token=${token}`;
    await config.mailer.send(
      {
        to,
        subject: "Reset your password",
        text: `Someone asked to reset the password for your account. Open this link to choose a new one:\n\n${link}\n\nIt works once, for an hour. If you did not ask for this, you can ignore this email; your password stays the same.`,
      },
      `reset-${digest(token).slice(0, 40)}`,
    );
  }
  // The link, used once while it lasts: the new password, every session of the account ended (a stolen one must not
  // survive a reset), in one statement.
  async function reset(token: string, passwordHash: string) {
    const result = /^[a-f0-9]{64}$/u.test(token)
      ? await db.query<User>(
          `WITH used AS (DELETE FROM app_password_resets WHERE token_hash=$1 RETURNING user_id,expires_at),
          changed AS (UPDATE app_users u SET password_hash=$2 FROM used
            WHERE u.id=used.user_id AND used.expires_at>now() RETURNING u.id,u.email,u.role),
          ended AS (DELETE FROM app_sessions s USING changed WHERE s.user_id=changed.id)
          SELECT id,email,role FROM changed`,
          [digest(token), passwordHash],
        )
      : { rows: [] };
    const user = result.rows[0];
    if (!user) throw new AccountError(400, RESET_REFUSED);
    return user;
  }
  // The link: used once, unexpired, and only for the address the account still has.
  async function verify(request: Request) {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const done = /^[a-f0-9]{64}$/u.test(token)
      ? await db.query(
          `WITH used AS (DELETE FROM app_email_verifications WHERE token_hash=$1 RETURNING user_id,email,expires_at)
          UPDATE app_users u SET email_verified_at=now() FROM used
          WHERE u.id=used.user_id AND u.email=used.email AND used.expires_at>now() RETURNING u.id`,
          [digest(token)],
        )
      : { rows: [] };
    return new Response(null, {
      status: 303,
      headers: {
        location: done.rows[0] ? "/?email=confirmed" : "/?email=link-expired",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }
  // Pramaan vouches for the owner once: a genuine pass, used once, signs into the one owner account, which is
  // made here and nowhere else (the app_users_one_owner index keeps it to one), then on to the owner area.
  async function ownerPass(request: Request) {
    const pass = readOwnerPass(
      new URL(request.url).searchParams.get("token") ?? "",
      config.secret,
      config.projectId,
    );
    if (!pass) throw new AccountError(401, PASS_REFUSED);
    await db.query("DELETE FROM app_owner_passes WHERE expires_at<now()");
    const fresh = await db.query(
      "INSERT INTO app_owner_passes(nonce,expires_at) VALUES($1,to_timestamp($2)) ON CONFLICT DO NOTHING RETURNING nonce",
      [pass.nonce, pass.exp],
    );
    if (!fresh.rows[0]) throw new AccountError(401, PASS_REFUSED);
    await db.query("INSERT INTO app_users(id,role) VALUES($1,'owner') ON CONFLICT DO NOTHING", [
      randomUUID(),
    ]);
    const owner = (await db.query<User>("SELECT id,email,role FROM app_users WHERE role='owner'"))
      .rows[0];
    if (!owner) throw new AccountError(503, "Something went wrong. Please try again.");
    return new Response(null, {
      status: 303,
      headers: {
        location: OWNER_AREA,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "set-cookie": await startSession(owner.id),
      },
    });
  }
  function credentials(input: Record<string, unknown>) {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254 || password.length > 1024)
      throw new AccountError(400, "Enter a valid email and password.");
    return { email, password };
  }
  function newPassword(password: string) {
    if (password.length < config.passwordMinLength)
      throw new AccountError(
        400,
        `Use at least ${config.passwordMinLength} characters for your password.`,
      );
    return hashPassword(password);
  }
  async function handle(request: Request, action: string) {
    try {
      if (action === "session" && request.method === "GET")
        return json({ user: await requireUser(request) });
      if (action === "owner-pass" && request.method === "GET") return await ownerPass(request);
      if (action === "verify" && request.method === "GET") return await verify(request);
      if (action === "tasks" && request.method === "GET") {
        const user = await requireUser(request);
        const result = await db.query(
          "SELECT id,title,completed FROM app_tasks WHERE user_id=$1 ORDER BY created_at,id",
          [user.id],
        );
        return json({ tasks: result.rows });
      }
      if (request.method !== "POST") throw new AccountError(405, "This action is not available.");
      // An owner-only product has no public sign-up: its owner comes from Pramaan's owner pass.
      if (action === "signup" && config.publicSignUp === false)
        throw new AccountError(404, "Action not found.");
      const input = await body(request);
      const origin = config.origin ?? new URL(request.url).origin;
      if (action === "verify-email") {
        // A fresh confirmation link for the signed-in account's own address, throttled like signing in.
        const user = await requireUser(request);
        if (await verifiedEmail(user.id)) return json({ verified: true });
        if ((await attempt(`verify ${user.id}`)) > config.authAttempts)
          throw new AccountError(429, "Please wait a moment before asking for another link.");
        if (!(await sendVerification(user, origin)))
          throw new AccountError(503, "The confirmation email could not be sent. Try again later.");
        return json({ sent: true });
      }
      if (action === "reset-request" || action === "reset") {
        // #1250: throttled per client (both actions) and per address; the link is sent after the answer.
        const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
        if (
          (await attempt(`reset client ${clientOf(request)}`)) > config.authClientAttempts ||
          (action === "reset-request" && (await attempt(`reset ${email}`)) > config.authAttempts)
        )
          throw new AccountError(
            429,
            "Too many attempts. Please wait a moment before trying again.",
          );
        if (action === "reset-request") {
          void sendReset(email, origin).catch(() =>
            console.error("Password reset email could not be sent"),
          );
          return json({ message: RESET_ANSWER });
        }
        const password = typeof input.password === "string" ? input.password : "";
        if (password.length > 1024) throw new AccountError(400, "Enter a shorter password.");
        const token = typeof input.token === "string" ? input.token : "";
        return await signedIn(await reset(token, await newPassword(password)));
      }
      if (action === "owner") {
        // The owner chooses the email and password they sign in with directly, without Pramaan.
        const owner = await requireRole(request, ["owner"]);
        const { email, password } = credentials(input);
        const result = await db
          .query<User>(
            // A new address is unverified until its link is opened (#1177).
            `UPDATE app_users SET email=$2,password_hash=$3,
            email_verified_at=CASE WHEN email=$2 THEN email_verified_at END
            WHERE id=$1 AND role='owner' RETURNING id,email,role`,
            [owner.id, email, await newPassword(password)],
          )
          .catch((error: { code?: string }) => {
            if (error?.code === "23505")
              throw new AccountError(
                409,
                "That email already has an account here. Choose another.",
              );
            throw error;
          });
        const updated = result.rows[0];
        // A new password ends the owner's other sessions: one someone else holds must not outlive the change.
        // This one, which made the change, stays.
        if (updated)
          await db.query("DELETE FROM app_sessions WHERE user_id=$1 AND token_hash<>$2", [
            updated.id,
            digest(tokenOf(request) ?? ""),
          ]);
        if (updated && !(await verifiedEmail(updated.id))) verifyLater(updated, origin);
        return json({ user: updated });
      }
      if (action === "signup" || action === "signin") {
        const { email, password } = credentials(input);
        // Indexed, bounded maintenance on authentication traffic. Expired
        // identities cannot accumulate forever; active windows remain intact.
        await db.query(
          `DELETE FROM app_auth_throttle WHERE key IN (
            SELECT key FROM app_auth_throttle WHERE started_at<now()-$1*interval '1 second'
            ORDER BY started_at LIMIT 100
          )`,
          [config.authWindowSeconds],
        );
        if (await throttled(email, clientOf(request)))
          throw new AccountError(
            429,
            "Too many attempts. Please wait a moment before trying again.",
          );
        if (action === "signup") {
          // A browser can never choose its own role or ownership, and signing up first makes no one the owner:
          // every account made here is a member.
          const passwordHash = await newPassword(password);
          const result = await db.query<User>(
            `INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)
            ON CONFLICT(email) DO NOTHING RETURNING id,email,role`,
            [randomUUID(), email, passwordHash],
          );
          if (!result.rows[0])
            throw new AccountError(409, "An account already exists. Try signing in.");
          verifyLater(result.rows[0], origin);
          return await signedIn(result.rows[0]);
        }
        const result = await db.query<User & { password_hash: string }>(
          "SELECT id,email,role,password_hash FROM app_users WHERE email=$1",
          [email],
        );
        const row = result.rows[0];
        const valid = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD);
        if (!row || !valid) throw new AccountError(401, "Email or password is incorrect.");
        return await signedIn({ id: row.id, email: row.email, role: row.role });
      }
      if (action === "signout") {
        // #1247: always ends the session the cookie names and clears it, whatever x-app-user says. Refusing a
        // mismatched header first left a signed-out person's session working (an app sent the wrong header).
        const token = tokenOf(request);
        if (token) await db.query("DELETE FROM app_sessions WHERE token_hash=$1", [digest(token)]);
        return json({ signedOut: true }, 200, cookie("", 0));
      }
      if (action === "tasks") {
        const user = await requireUser(request);
        if (input.action === "create") {
          const title = typeof input.title === "string" ? input.title.trim() : "";
          if (!title || title.length > config.taskTitleLength)
            throw new AccountError(
              400,
              `Enter a task of up to ${config.taskTitleLength} characters.`,
            );
          const result = await db.query(
            "INSERT INTO app_tasks(id,user_id,title) VALUES($1,$2,$3) RETURNING id,title,completed",
            [randomUUID(), user.id, title],
          );
          return json({ task: result.rows[0] }, 201);
        }
        if (
          typeof input.id !== "string" ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(input.id)
        )
          throw new AccountError(400, "Select a task.");
        const result =
          input.action === "delete"
            ? await db.query("DELETE FROM app_tasks WHERE id=$1 AND user_id=$2 RETURNING id", [
                input.id,
                user.id,
              ])
            : input.action === "complete" && typeof input.completed === "boolean"
              ? await db.query(
                  "UPDATE app_tasks SET completed=$3 WHERE id=$1 AND user_id=$2 RETURNING id,title,completed",
                  [input.id, user.id, input.completed],
                )
              : null;
        if (!result) throw new AccountError(400, "Choose a valid task action.");
        if (!result.rows[0]) throw new AccountError(404, "Task not found.");
        return json({ task: result.rows[0] });
      }
      throw new AccountError(404, "Action not found.");
    } catch (error) {
      return error instanceof AccountError
        ? json({ error: error.message }, error.status)
        : json({ error: "Something went wrong. Please try again." }, 503);
    }
  }
  return { handle, requireUser, requireRole, verifiedEmail };
}
