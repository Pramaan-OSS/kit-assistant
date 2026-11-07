import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
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
const accountsOn = (pool: Pool) =>
  createAccounts(pool, {
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
const accountRequest = (action: string, input: object) =>
  new Request(`http://localhost/api/account/${action}`, {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
const statusOf = async (id: string) =>
  (await db.query("SELECT status FROM assistant_approvals WHERE id=$1", [id])).rows[0].status;
const emailCalls = () =>
  fake.calls.filter((c: { route: string }) => c.route.endsWith("email.send")).length;
async function doorReaches(count: number) {
  for (let i = 0; i < 200 && emailCalls() < count; i++) await setTimeout(10);
  expect(emailCalls()).toBe(count);
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
  fake.state.slowEmailMs = 0;
  fake.state.failSlowEmail = false;
  fake.facts.clear();
  fake.sent.length = 0;
  fake.calls.length = 0;
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
  it("keeps approvals, second clicks and sign-in moving while the door is slow", async () => {
    // The platform's pool size. The short connect wait turns a held pool into a failure rather than a long hang.
    const small = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 1500,
    });
    const slowApp = createAssistant(small, pramaan, "assistant-test");
    const approve = (id: string) =>
      slowApp.handle(owner, "approvals", "POST", { id, decision: "approve" });
    try {
      const accounts = accountsOn(small);
      const member = { email: "slow@example.test", password: "test-password-long" };
      expect((await accounts.handle(accountRequest("signup", member), "signup")).status).toBe(200);
      const ids = [await draft(), await draft(), await draft(), await draft()];
      fake.state.slowEmailMs = 3000;
      const slow = ids.slice(0, 3).map(approve);
      await doorReaches(3);
      const fourth = approve(ids[3] as string);
      await doorReaches(4);
      await expect(approve(ids[0] as string)).rejects.toMatchObject({ unknown: true });
      expect((await accounts.handle(accountRequest("signin", member), "signin")).status).toBe(200);
      await Promise.all([...slow, fourth]);
      for (const id of ids) {
        expect(await statusOf(id)).toBe("waiting");
        await call(owner, "approval-status", { id });
      }
      expect(fake.sent).toHaveLength(4);
    } finally {
      await small.end();
    }
  }, 15000);
  it("runs one call for two overlapping clicks and keeps the first click's result", async () => {
    const id = await draft();
    fake.state.slowEmailMs = 300;
    const first = call(owner, "approvals", { id, decision: "approve" });
    await doorReaches(1);
    await expect(call(owner, "approvals", { id, decision: "approve" })).rejects.toMatchObject({
      unknown: true,
    });
    expect(await statusOf(id)).toBe("unknown");
    await expect(call(owner, "approvals", { id, decision: "deny" })).rejects.toMatchObject({
      status: 409,
    });
    await first;
    expect(await statusOf(id)).toBe("waiting");
    await call(owner, "approval-status", { id });
    expect(await statusOf(id)).toBe("done");
    expect(fake.sent).toHaveLength(1);
  });
  it("never lets a late uncertain refusal replace the running call's result", async () => {
    const id = await draft();
    fake.state.slowEmailMs = 300;
    let finish = () => {};
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const late = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("status='unknown' WHERE id=$1")) await held;
        return db.query(sql, values);
      },
    } as unknown as Pool;
    const first = call(owner, "approvals", { id, decision: "approve" });
    await doorReaches(1);
    const second = createAssistant(late, pramaan, "assistant-test").handle(
      owner,
      "approvals",
      "POST",
      { id, decision: "approve" },
    );
    await first;
    finish();
    await expect(second).rejects.toMatchObject({ unknown: true });
    expect(await statusOf(id)).toBe("waiting");
  });
  it("keeps a request retryable when the running call fails after an overlapping click", async () => {
    const id = await draft();
    fake.state.slowEmailMs = 300;
    fake.state.failSlowEmail = true;
    const first = call(owner, "approvals", { id, decision: "approve" });
    await doorReaches(1);
    await expect(call(owner, "approvals", { id, decision: "approve" })).rejects.toMatchObject({
      unknown: true,
    });
    await expect(first).rejects.toMatchObject({ unknown: false, off: false });
    expect(await statusOf(id)).toBe("approved");
    fake.state.slowEmailMs = 0;
    await call(owner, "approvals", { id, decision: "approve" });
    await call(owner, "approval-status", { id });
    expect(fake.sent).toHaveLength(1);
  });
  it("recovers an outcome it could not record by retrying under the same key", async () => {
    const id = await draft();
    let lost = false;
    const flaky = {
      query(sql: string, values: unknown[]) {
        if (!lost && sql.includes("job_id=$3")) {
          lost = true;
          return Promise.reject(new Error("storage went away"));
        }
        return db.query(sql, values);
      },
    } as unknown as Pool;
    const flakyApp = createAssistant(flaky, pramaan, "assistant-test");
    const approve = () => flakyApp.handle(owner, "approvals", "POST", { id, decision: "approve" });
    await expect(approve()).rejects.toThrow("storage went away");
    expect(await statusOf(id)).toBe("approved");
    await approve();
    expect(await statusOf(id)).toBe("waiting");
    await call(owner, "approval-status", { id });
    expect(fake.sent).toHaveLength(1);
    expect(emailCalls()).toBe(2);
  });
  it("releases a member who decided a request, and the request keeps its outcome", async () => {
    const id = await draft();
    await call(owner, "team", { email: bob.email, role: "admin" });
    await call({ ...bob, role: "admin" }, "approvals", { id, decision: "approve" });
    await call(owner, "team", { email: bob.email });
    // The starter's own statement, from the owner action in lib/accounts.ts once it is re-synced here.
    const released = await db.query(
      "DELETE FROM app_users WHERE email=$1 AND role='member' AND email_verified_at IS NULL AND id<>$2",
      [bob.email, owner.id],
    );
    expect(released.rowCount).toBe(1);
    const row = (
      await db.query("SELECT status,decided_by,job_id,input FROM assistant_approvals WHERE id=$1", [
        id,
      ])
    ).rows[0];
    expect(row).toMatchObject({
      status: "waiting",
      decided_by: null,
      job_id: expect.any(String),
      input: { to: "recipient@example.test", subject: "Proposal" },
    });
    await call(owner, "approval-status", { id });
    expect(await statusOf(id)).toBe("done");
    expect(fake.sent).toHaveLength(1);
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
    const accounts = accountsOn(db);
    const response = await accounts.handle(
      accountRequest("signup", {
        email: "new@example.test",
        password: "test-password-long",
        role: "owner",
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
