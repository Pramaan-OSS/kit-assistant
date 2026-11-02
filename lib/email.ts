// The app's way to send email: the platform's module door (docs/contracts/app-modules.md "Email"). Server only.
// The running draft and live app have it mounted at /pramaan-modules; `pramaan check`, the build and a local
// `next dev` don't, and with email off the door refuses: then nothing is sent, and a send says so.
import { readFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";

export type Outgoing = { to: string; subject: string; text: string };
/** `sent`, or not: `unknown` when it may have gone (never sent again under that key). */
export type Sent = { status: "sent" | "not-sent" | "unknown" };
export type Mailer = { send(message: Outgoing, key: string): Promise<Sent> };

// PRAMAAN_MODULES_DIR exists for tests only.
const dir = () => process.env.PRAMAAN_MODULES_DIR ?? "/pramaan-modules";

/** One message under `key`, the Idempotency-Key: the same key never sends twice. Never throws. */
export const emailDoor: Mailer = {
  send(message, key) {
    return new Promise((resolve) => {
      let token: string;
      try {
        token = readFileSync(path.join(dir(), "token"), "utf8").trim();
      } catch {
        resolve({ status: "not-sent" });
        return;
      }
      const body = JSON.stringify(message);
      const sent = request(
        {
          socketPath: path.join(dir(), "modules.sock"),
          method: "POST",
          path: "/v1/email",
          timeout: 70_000,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "idempotency-key": key,
          },
        },
        (response) => {
          response.resume();
          const code = response.statusCode ?? 0;
          resolve({
            status: code === 200 || code === 202 ? "sent" : code === 504 ? "unknown" : "not-sent",
          });
        },
      );
      sent.on("timeout", () => sent.destroy(new Error("timeout")));
      // Never reached: nothing went. Reached and no answer: it may have gone.
      sent.on("error", (error: { code?: string }) =>
        resolve({
          status: error.code === "ENOENT" || error.code === "ECONNREFUSED" ? "not-sent" : "unknown",
        }),
      );
      sent.end(body);
    });
  },
};
