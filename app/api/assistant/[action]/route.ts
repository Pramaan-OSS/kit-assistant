import { AccountError } from "../../../../lib/accounts";
import { CapabilityError, pramaan } from "../../../../lib/assistant/pramaan";
import { createAssistant } from "../../../../lib/assistant/service";
import { accountRuntime, database } from "../../../../lib/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function route(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    const user = await accountRuntime().requireUser(request);
    let input: Record<string, unknown> = Object.fromEntries(new URL(request.url).searchParams);
    if (request.method === "POST") {
      if (request.headers.get("origin") !== (process.env.APP_ORIGIN ?? new URL(request.url).origin))
        throw new AccountError(403, "Refresh this page and try again.");
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new AccountError(415, "Send JSON.");
      const reader = request.body?.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (!reader) throw new AccountError(400, "Enter the details first.");
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 20000) {
          await reader.cancel();
          throw new AccountError(413, "These details are too long.");
        }
        chunks.push(part.value);
      }
      try {
        input = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw new AccountError(400, "Check the details and try again.");
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new AccountError(400, "Check the details and try again.");
    }
    const { action } = await context.params;
    const service = createAssistant(
      database(),
      pramaan,
      process.env.PRAMAAN_PROJECT_ID ?? "assistant",
    );
    if (action === "chat" && request.method === "POST")
      return await service.chat(user, input, request.signal);
    return Response.json(await service.handle(user, action, request.method, input), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    const status = e instanceof AccountError ? e.status : e instanceof CapabilityError ? 503 : 500;
    return Response.json(
      {
        error:
          e instanceof AccountError || e instanceof CapabilityError
            ? e.message
            : "Storage is not ready. Please try again shortly.",
        off: e instanceof CapabilityError && e.off,
        unknown: e instanceof CapabilityError && e.unknown,
      },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}

export { route as GET, route as POST };
