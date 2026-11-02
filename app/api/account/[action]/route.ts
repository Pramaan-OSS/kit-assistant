import { accountRuntime } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function route(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    return await accountRuntime().handle(request, (await context.params).action);
  } catch {
    return Response.json(
      { error: "This app's storage is not ready yet. Please try again shortly." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export { route as GET, route as POST };
