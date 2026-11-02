import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { fakeDoor } = await import(new URL("../../scripts/fake-door.mjs", import.meta.url).href);

import { createAccounts, type User } from "../accounts";
import { pramaan } from "./pramaan";
import { createAssistant } from "./service";

const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const owner: User = { id: "00000000-0000-4000-8000-000000000001", role: "owner", email: null };
const alice: User = {
  id: "00000000-0000-4000-8000-000000000002",
  role: "member",
  email: "alice@example.test",
};
const bob: User = {
  id: "00000000-0000-4000-8000-000000000003",
  role: "member",
  email: "bob@example.test",
};
const stranger: User = {
  id: "00000000-0000-4000-8000-000000000004",
  role: "member",
  email: "stranger@example.test",
};
let dir: string;
let fake: Awaited<ReturnType<typeof fakeDoor>>;
const app = createAssistant(db, pramaan, "assistant-test");
const call = (u: User, a: string, input: Record<string, unknown> = {}) =>
  app.handle(u, a, "POST", input);
const get = (u: User, a: string, input: Record<string, unknown> = {}) =>
  app.handle(u, a, "GET", input);
async function chat(u = alice, message = "Hello") {
  const c = (await call(u, "conversations", { title: "Private" })) as { id: string };
  const res = await app.chat(u, { id: c.id, message, key: randomUUID() });
  return { id: c.id, stream: await res.text() };
}
async function draft() {
  const c = (await call(alice, "conversations", { title: "Email" })) as { id: string };
  await call(alice, "email", {
    conversation: c.id,
    to: "recipient@example.test",
    subject: "Proposal",
    text: "Please review.",
  });
  return (await db.query("SELECT id FROM assistant_approvals ORDER BY created_at DESC LIMIT 1"))
    .rows[0].id;
}
beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw Error("Real Postgres is required.");
  dir = await mkdtemp(path.join(tmpdir(), "kit-asst-"));
  fake = await fakeDoor(dir);
  process.env.PRAMAAN_MODULES_DIR = dir;
});
beforeEach(async () => {
  await db.query("TRUNCATE app_users CASCADE");
  await db.query("DELETE FROM assistant_settings");
  for (const u of [owner, alice, bob, stranger])
    await db.query("INSERT INTO app_users(id,email,password_hash,role) VALUES($1,$2,'unused',$3)", [
      u.id,
      u.email,
      u.role,
    ]);
  for (const u of [alice, bob])
    await db.query("INSERT INTO assistant_members(user_id) VALUES($1)", [u.id]);
  await call(owner, "setup", { name: "Team guide", instructions: "Be helpful." });
  fake.state.off = false;
  fake.state.missingCalls = false;
  fake.state.unknownEmail = false;
  fake.state.malformedStream = false;
  fake.facts.clear();
  fake.sent.length = 0;
});
afterAll(async () => {
  await fake.close();
  await db.end();
  await rm(dir, { recursive: true, force: true });
  delete process.env.PRAMAAN_MODULES_DIR;
});
describe("Assistant on a real database and fake module socket", () => {
  it("streams and saves a reply, stripping private transport metadata", async () => {
    const c = await chat();
    expect(c.stream).toContain("Hello.");
    expect(c.stream).toContain("event: done");
    expect(c.stream).not.toContain("provider");
    const history = (await get(alice, "messages", { id: c.id })) as {
      results: { content: string }[];
    };
    expect(history.results).toHaveLength(2);
    expect(history.results[1]?.content).toContain("help your team");
  });
  it("isolates history and memory from other members and the owner", async () => {
    const c = await chat();
    await expect(get(bob, "messages", { id: c.id })).rejects.toMatchObject({ status: 404 });
    await expect(get(owner, "messages", { id: c.id })).rejects.toMatchObject({ status: 404 });
    await call(alice, "remember", { fact: "Prefers short meetings", key: randomUUID() });
    expect(((await get(bob, "memories")) as { results: unknown[] }).results).toEqual([]);
    const reply = await chat();
    expect(reply.stream).toContain("remember you prefer short meetings");
  });
  it("remembers once across retries and forgets one owned fact", async () => {
    const key = randomUUID();
    await call(alice, "remember", { fact: "A private fact", key });
    await call(alice, "remember", { fact: "A private fact", key });
    const rows = (await get(alice, "memories")) as { results: { ref: string }[] };
    expect(rows.results).toHaveLength(1);
    await expect(
      call(bob, "forget", { ref: rows.results[0]?.ref, confirm: true, key: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    await call(alice, "forget", { ref: rows.results[0]?.ref, confirm: true, key: randomUUID() });
    expect(((await get(alice, "memories")) as { results: unknown[] }).results).toEqual([]);
  });
  it("forgets an entire scope through a job and checks operation ownership", async () => {
    await call(alice, "remember", { fact: "Keep private", key: randomUUID() });
    const key = randomUUID();
    await call(alice, "forget", { all: true, confirm: true, key });
    await expect(call(bob, "operation-status", { key })).rejects.toMatchObject({ status: 404 });
    expect(await call(alice, "operation-status", { key })).toMatchObject({ status: "done" });
    expect(((await get(alice, "memories")) as { results: unknown[] }).results).toEqual([]);
  });
  it("makes a model-requested email wait for approval with no delivery", async () => {
    const c = await chat(alice, "Draft email");
    expect(c.stream).toContain("waiting for approval");
    expect(fake.sent).toHaveLength(0);
    expect((await db.query("SELECT * FROM assistant_approvals")).rows).toHaveLength(1);
  });
  it("rejects member decisions and executes an approved email exactly once", async () => {
    const id = await draft();
    await expect(call(alice, "approvals", { id, decision: "approve" })).rejects.toMatchObject({
      status: 403,
    });
    await call(owner, "approvals", { id, decision: "approve" });
    await expect(call(owner, "approvals", { id, decision: "approve" })).rejects.toMatchObject({
      status: 409,
    });
    await call(owner, "approval-status", { id });
    await call(owner, "approval-status", { id });
    expect(fake.sent).toEqual([
      { to: "recipient@example.test", subject: "Proposal", text: "Please review." },
    ]);
  });
  it("declines and expires requests without sending", async () => {
    let id = await draft();
    await call(owner, "approvals", { id, decision: "deny" });
    await expect(call(owner, "approvals", { id, decision: "approve" })).rejects.toMatchObject({
      status: 409,
    });
    id = await draft();
    await db.query(
      "UPDATE assistant_approvals SET expires_at=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    await expect(call(owner, "approvals", { id, decision: "approve" })).rejects.toMatchObject({
      status: 409,
    });
    const listed = (await get(owner, "approvals")) as { results: { id: string; status: string }[] };
    expect(listed.results.find((a) => a.id === id)?.status).toBe("expired");
    expect(fake.sent).toEqual([]);
  });
  it("retains approved input and key through capability-off and retries safely", async () => {
    const id = await draft();
    fake.state.off = true;
    await expect(call(owner, "approvals", { id, decision: "approve" })).rejects.toMatchObject({
      off: true,
    });
    expect(
      (await db.query("SELECT status FROM assistant_approvals WHERE id=$1", [id])).rows[0].status,
    ).toBe("approved");
    fake.state.off = false;
    await call(owner, "approvals", { id, decision: "approve" });
    await call(owner, "approval-status", { id });
    expect(fake.sent).toHaveLength(1);
  });
  it("holds unknown delivery outcomes and refuses blind retries", async () => {
    const id = await draft();
    fake.state.unknownEmail = true;
    await expect(call(owner, "approvals", { id, decision: "approve" })).rejects.toMatchObject({
      unknown: true,
    });
    await expect(call(owner, "approvals", { id, decision: "approve" })).rejects.toMatchObject({
      status: 409,
    });
  });
  it("shows capability-off for chat, memory and owner wallet/activity", async () => {
    fake.state.off = true;
    await expect(chat()).rejects.toMatchObject({ off: true });
    await expect(get(alice, "memories")).rejects.toMatchObject({ off: true });
    await expect(
      call(alice, "remember", { fact: "hello", key: randomUUID() }),
    ).rejects.toMatchObject({ off: true });
    await expect(
      call(alice, "forget", { all: true, confirm: true, key: randomUUID() }),
    ).rejects.toMatchObject({ off: true });
    await expect(get(owner, "usage")).rejects.toMatchObject({ off: true });
  });
  it("limits setup, team grants, wallet and activity to the proper roles", async () => {
    await expect(call(alice, "setup", { name: "No", instructions: "No" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(call(alice, "team", { email: bob.email, role: "admin" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(get(alice, "usage")).rejects.toMatchObject({ status: 403 });
    expect(await get(owner, "usage")).toMatchObject({ balanceMicro: 12500000, spendMicro: 250000 });
    await call(owner, "team", { email: bob.email, role: "admin" });
    const admin = { ...bob, role: "admin" };
    await expect(call(admin, "team", { email: alice.email })).rejects.toMatchObject({
      status: 403,
    });
    await expect(get(admin, "usage")).rejects.toMatchObject({ status: 403 });
    await expect(get(admin, "approvals")).resolves.toBeDefined();
  });
  it("falls back to real daily usage when per-call activity is unavailable", async () => {
    fake.state.missingCalls = true;
    expect(await get(owner, "usage")).toMatchObject({
      spendMicro: 250000,
      activity: [{ status: "daily total" }],
    });
  });
  it("blocks unassigned and removed team members immediately", async () => {
    await expect(get(stranger, "state")).rejects.toMatchObject({ status: 403 });
    await call(owner, "team", { email: alice.email, remove: true });
    await expect(get(alice, "state")).rejects.toMatchObject({ status: 403 });
  });
  it("refuses changed retry inputs and unconfirmed deletes", async () => {
    const key = randomUUID();
    await call(alice, "remember", { fact: "one", key });
    await expect(call(alice, "remember", { fact: "two", key })).rejects.toMatchObject({
      status: 409,
    });
    await expect(call(alice, "forget", { all: true, key: randomUUID() })).rejects.toMatchObject({
      status: 400,
    });
  });
  it("does not save an incomplete answer and releases the conversation", async () => {
    fake.state.malformedStream = true;
    const c = await chat();
    expect(c.stream).toContain("event: error");
    expect(
      ((await get(alice, "messages", { id: c.id })) as { results: unknown[] }).results,
    ).toHaveLength(1);
    expect(
      (await db.query("SELECT busy FROM assistant_conversations WHERE id=$1", [c.id])).rows[0].busy,
    ).toBe(false);
  });
  it("keeps the starter accounts and owner pass working with server-owned roles", async () => {
    const accounts = createAccounts(db, {
      secret: "test-secret-for-assistant-contract-123456",
      projectId: "assistant-test",
      origin: "http://localhost",
      secureCookies: false,
      publicSignUp: true,
      sessionSeconds: 3600,
      passwordMinLength: 12,
      maxBodyBytes: 16384,
      taskTitleLength: 240,
      authAttempts: 10,
      authClientAttempts: 30,
      authWindowSeconds: 60,
    });
    const response = await accounts.handle(
      new Request("http://localhost/api/account/signup", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({
          email: "new@example.test",
          password: "test-password-long",
          role: "owner",
        }),
      }),
      "signup",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.role).toBe("member");
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(
      (await accounts.requireUser(new Request("http://localhost", { headers: { cookie } }))).id,
    ).toBe(body.user.id);
  });
});
