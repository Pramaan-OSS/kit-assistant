import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
/** Local test fixture implementing the module HTTP boundary, never selected by production code. */
export async function fakeDoor(dir) {
  await mkdir(dir, { recursive: true });
  await rm(path.join(dir, "modules.sock"), { force: true });
  const token = randomUUID();
  await writeFile(path.join(dir, "token"), token, { mode: 0o600 });
  const facts = new Map();
  const jobs = new Map();
  const keys = new Map();
  const sent = [];
  const calls = [];
  const history = [];
  const state = { off: false, asyncEmail: true, unknownEmail: false, malformedStream: false };
  const server = createServer(async (req, res) => {
    const reply = (value, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.headers.authorization !== `Bearer ${token}`)
      return reply({ error: "MODULE_TOKEN_INVALID" }, 401);
    if (state.off) return reply({ error: "MODULE_OFF" }, 404);
    let input = {};
    try {
      let body = "";
      for await (const c of req) body += c;
      if (body) input = JSON.parse(body);
    } catch {
      return reply({ error: "INVALID_REQUEST" }, 400);
    }
    const route = req.url;
    calls.push({ route, input });
    if (route === "/v1/balance") return reply({ balance_micro: 12500000 });
    if (route.startsWith("/v1/usage"))
      return reply({
        results: [
          { day: new Date().toISOString().slice(0, 10), calls: calls.length, spend_micro: 250000 },
        ],
      });
    if (route.startsWith("/v1/calls") && state.missingCalls)
      return reply({ error: "NOT_FOUND" }, 404);
    if (route.startsWith("/v1/calls"))
      return reply({
        results: [
          {
            status: "done",
            created_at: new Date().toISOString(),
            provider: "hidden",
            provider_id: "hidden",
          },
        ],
      });
    if (route.startsWith("/v1/jobs/")) {
      const job = jobs.get(decodeURIComponent(route.split("/").pop()));
      if (!job) return reply({ error: "NOT_FOUND" }, 404);
      if (job.finish) {
        job.finish();
        delete job.finish;
        job.status = "done";
      }
      return reply({ status: job.status, result: job.result ?? {} });
    }
    const capability = decodeURIComponent(route.split("/").pop());
    const scoped = JSON.stringify(input.scope);
    const rows = facts.get(scoped) ?? [];
    if (capability === "llm.chat") {
      history.push(input);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
      const message = input.messages.at(-1).content;
      emit("provider_metadata", { provider: "hidden" });
      if (message.toLowerCase().includes("draft email")) {
        emit("tool_call_start", { index: 0, id: "call_1", name: "send_email" });
        emit("tool_call_delta", {
          index: 0,
          arguments: JSON.stringify({
            to: "recipient@example.test",
            subject: "Review my proposal",
            text: "Please review the proposal.",
          }),
        });
        emit("tool_call_end", { id: "call_1" });
      } else {
        const known = input.messages[0].content.includes("Prefers short meetings");
        for (const delta of [
          "Hello. ",
          known ? "I remember you prefer short meetings." : "How can I help your team?",
        ])
          emit("text_delta", { text: delta });
      }
      if (!state.malformedStream) emit("done", {});
      return res.end();
    }
    if (capability === "memory.items.list" || capability === "memory.items.search")
      return reply({ results: rows });
    if (capability === "memory.history.list") return reply({ results: [] });
    const key = req.headers["idempotency-key"];
    if (!key) return reply({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    const digest = JSON.stringify({ capability, input });
    const old = keys.get(key);
    if (old) {
      if (old.digest !== digest) return reply({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
      return reply(old.result);
    }
    let result = {};
    if (capability === "memory.add") {
      const fact = {
        ref: `ref_${randomUUID().replaceAll("-", "")}`,
        text: input.messages[0].content,
      };
      facts.set(scoped, [...rows, fact]);
      result = { results: [fact] };
    } else if (capability === "memory.item.delete") {
      facts.set(
        scoped,
        rows.filter((r) => r.ref !== input.ref),
      );
      result = { deleted: true };
    } else if (capability === "memory.scope.delete") {
      const job = `job_${randomUUID()}`;
      jobs.set(job, { status: "running", finish: () => facts.set(scoped, []) });
      result = { status: "running", job_id: job };
    } else if (capability === "email.send") {
      if (state.unknownEmail) return reply({ error: "MODULE_OUTCOME_UNKNOWN" }, 504);
      if (state.asyncEmail) {
        const job = `job_${randomUUID()}`;
        jobs.set(job, { status: "running", finish: () => sent.push(input) });
        result = { status: "running", job_id: job };
      } else {
        sent.push(input);
        result = { sent: true };
      }
    } else return reply({ error: "CAPABILITY_DISABLED" }, 403);
    keys.set(key, { digest, result });
    reply(result);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path.join(dir, "modules.sock"), resolve);
  });
  return {
    state,
    facts,
    jobs,
    keys,
    sent,
    calls,
    history,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
