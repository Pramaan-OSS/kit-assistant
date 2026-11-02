import { readFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";

export class CapabilityError extends Error {
  constructor(
    public off = false,
    public unknown = false,
    public status = 0,
  ) {
    super(
      off
        ? "This capability is off. Ask the owner to enable it for this app."
        : unknown
          ? "The result is uncertain. Check its status before trying again."
          : "This capability could not finish. Please try again later.",
    );
  }
}
export interface PramaanClient {
  call<T = Record<string, unknown>>(
    id: string,
    input: Record<string, unknown>,
    key: string,
  ): Promise<T>;
  get<T = Record<string, unknown>>(route: string): Promise<T>;
  stream(input: Record<string, unknown>, signal?: AbortSignal): Promise<Response>;
}
/** The only outbound client. The platform keeps its API key; this app reads only its mounted socket token. */
async function send(
  method: string,
  route: string,
  input?: Record<string, unknown>,
  key?: string,
  stream = false,
  signal?: AbortSignal,
): Promise<Response> {
  const dir = process.env.PRAMAAN_MODULES_DIR ?? "/pramaan-modules";
  let token: string;
  try {
    token = readFileSync(path.join(dir, "token"), "utf8").trim();
  } catch {
    throw new CapabilityError(true);
  }
  const body = input === undefined ? undefined : JSON.stringify(input);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: path.join(dir, "modules.sock"),
        path: route,
        method,
        timeout: 60000,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
            : {}),
          ...(key ? { "idempotency-key": key } : {}),
          ...(stream ? { accept: "text/event-stream" } : {}),
        },
        signal,
      },
      (res) => {
        if ((res.statusCode ?? 500) >= 400) {
          let bytes = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 65536) res.destroy();
            else chunks.push(chunk);
          });
          res.on("end", () => {
            let code = "";
            try {
              const value = JSON.parse(Buffer.concat(chunks).toString());
              code = value.error?.code ?? value.error ?? "";
            } catch {}
            reject(
              new CapabilityError(
                ["NO_DOOR", "MODULE_OFF", "CAPABILITY_DISABLED", "TRANSPORT_UNAVAILABLE"].includes(
                  code,
                ) || res.statusCode === 404,
                ["IDEMPOTENCY_PENDING", "MODULE_OUTCOME_UNKNOWN"].includes(code),
                res.statusCode,
              ),
            );
          });
          res.on("error", () => reject(new CapabilityError(false, method === "POST")));
        } else
          resolve(
            new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
              status: res.statusCode,
              headers: { "content-type": res.headers["content-type"] ?? "application/json" },
            }),
          );
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        new CapabilityError(
          e.code === "ENOENT" || e.code === "ECONNREFUSED",
          method === "POST" && !["ENOENT", "ECONNREFUSED"].includes(e.code ?? ""),
        ),
      ),
    );
    req.end(body);
  });
}
async function json<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.length > 2_000_000) throw new CapabilityError();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CapabilityError();
  }
}
export const pramaan: PramaanClient = {
  async call<T>(id: string, input: Record<string, unknown>, key: string) {
    return json<T>(await send("POST", `/v1/capabilities/${encodeURIComponent(id)}`, input, key));
  },
  async get<T>(route: string) {
    return json<T>(await send("GET", route));
  },
  async stream(input, signal) {
    const result = await send("POST", "/v1/capabilities/llm.chat", input, undefined, true, signal);
    if (!result.headers.get("content-type")?.includes("text/event-stream")) {
      await result.body?.cancel();
      throw new CapabilityError(true);
    }
    return result;
  },
};
