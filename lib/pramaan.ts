// The app's Superpowers: the platform's module door (docs/contracts/app-modules.md "Superpowers from the lab").
// Server only. The running draft and live app have it mounted at /pramaan-modules; `pramaan check`, the build and a
// local `next dev` don't, so every call can fail, and says why in words a person can read. There is no key and no
// address here: the platform holds them, and decides each call.
import { readFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";

// PRAMAAN_MODULES_DIR exists for tests only.
const dir = () => process.env.PRAMAAN_MODULES_DIR ?? "/pramaan-modules";

/** One Superpower as the platform describes it; `describe` adds its `request_schema` and `result_schema`. */
export type Superpower = {
  id: string;
  family: string;
  title?: string;
  description: string;
  risk: string;
  price_estimate_micro: number;
  [field: string]: unknown;
};
/**
 * How a request went. Not `ok`: `message` is the sentence to show the user. `off`: this Superpower is not switched on
 * for this app (or Superpowers are not on here), so nothing ran. `unknown`: a call may have gone through, so repeat it
 * only under the same key.
 */
export type Answer<T> =
  | { ok: true; value: T }
  | { ok: false; off: boolean; unknown: boolean; code: string; message: string };

const NO_DOOR =
  "Superpowers are not available here. They work in the running app, not during a check or a build.";
const OFF = ["MODULE_OFF", "CAPABILITY_DISABLED", "NO_DOOR"];
const UNKNOWN = ["MODULE_OUTCOME_UNKNOWN", "IDEMPOTENCY_PENDING"];

class NoDoorError extends Error {}

function door(
  method: string,
  route: string,
  body?: string,
  key?: string,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    let token: string;
    try {
      token = readFileSync(path.join(dir(), "token"), "utf8").trim();
    } catch {
      reject(new NoDoorError());
      return;
    }
    const headers: Record<string, string | number> = { authorization: `Bearer ${token}` };
    if (body !== undefined)
      Object.assign(headers, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
    if (key !== undefined) headers["idempotency-key"] = key;
    const sent = request(
      {
        socketPath: path.join(dir(), "modules.sock"),
        method,
        path: route,
        headers,
        timeout: 70_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          let json: unknown = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            /* no body */
          }
          resolve({ status: response.statusCode ?? 0, json });
        });
        response.on("error", reject);
      },
    );
    sent.on("timeout", () => sent.destroy(new Error("The platform's module door did not answer")));
    sent.on("error", reject);
    sent.end(body);
  });
}

/** A refusal, in either of the door's shapes: `{ error: { code, message } }` or `{ error, message }`. */
function refused(status: number, json: unknown): Answer<never> {
  const said = (json ?? {}) as { error?: unknown; message?: unknown };
  const inner = (typeof said.error === "object" && said.error !== null ? said.error : {}) as {
    code?: unknown;
    message?: unknown;
    effect?: unknown;
  };
  const code = String(inner.code ?? said.error ?? `HTTP_${status}`);
  const message = String(inner.message ?? said.message ?? "The Superpower could not answer.").slice(
    0,
    300,
  );
  const unknown =
    UNKNOWN.includes(code) || (code === "CAPABILITY_UNAVAILABLE" && inner.effect !== "none");
  return { ok: false, off: OFF.includes(code), unknown, code, message };
}

async function ask<T>(
  method: string,
  route: string,
  body?: string,
  key?: string,
): Promise<Answer<T>> {
  try {
    const answer = await door(method, route, body, key);
    // 202 is a job the lab started: its value names it (GET /v1/jobs/<id> reads it).
    if (answer.status === 200 || answer.status === 202)
      return { ok: true, value: answer.json as T };
    return refused(answer.status, answer.json);
  } catch (error) {
    if (error instanceof NoDoorError) return refused(0, { error: "NO_DOOR", message: NO_DOOR });
    // The socket was never reached: nothing went.
    const code = (error as { code?: unknown })?.code;
    if (code === "ENOENT" || code === "ECONNREFUSED")
      return refused(0, {
        error: "DOOR_UNREACHABLE",
        message: "Superpowers did not answer, so nothing ran.",
      });
    return refused(0, {
      error: "MODULE_OUTCOME_UNKNOWN",
      message: "Superpowers did not answer, so this may or may not have gone through.",
    });
  }
}

export const pramaan = {
  /** The Superpowers switched on for this app. */
  async list(): Promise<Answer<Superpower[]>> {
    const answer = await ask<{ results: Superpower[] }>("GET", "/v1/capabilities");
    return answer.ok ? { ok: true, value: answer.value.results } : answer;
  },
  /** One of them, with the schema of its input and its result. */
  describe(id: string): Promise<Answer<Superpower>> {
    return ask("GET", `/v1/capabilities/${encodeURIComponent(id)}`);
  },
  /**
   * Calls one with its input. `key` is the Idempotency-Key (a new UUID kept with the request for its retries): one
   * that changes something needs it, and the same key never runs twice.
   */
  call<T = unknown>(id: string, input: Record<string, unknown>, key?: string): Promise<Answer<T>> {
    return ask("POST", `/v1/capabilities/${encodeURIComponent(id)}`, JSON.stringify(input), key);
  },
};
