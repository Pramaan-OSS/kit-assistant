import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { Pool } from "pg";

const config = JSON.parse(await readFile(".evidence/runtime.json", "utf8"));
if (new URL(config.origin).port !== "3412") throw Error("Walk only uses port 3412");
if (!process.env.DATABASE_URL) throw Error("Walk requires its disposable DATABASE_URL");
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
await db.query("TRUNCATE app_users CASCADE");
await db.query("DELETE FROM assistant_settings");
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
await mkdir(".evidence/screens", { recursive: true });
function pass(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      role: "owner",
      project: config.project,
      iat: now,
      exp: now + 60,
      nonce: randomBytes(18).toString("base64url"),
      ...overrides,
    }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", config.secret).update(`pramaan-owner-pass.v1.${body}`).digest("base64url")}`;
}
async function context() {
  const c = await browser.newContext({
    baseURL: config.origin,
    viewport: { width: 1280, height: 900 },
  });
  c.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  return c;
}
async function off(value) {
  const nonce = randomBytes(8).toString("hex");
  await writeFile(".scratch/fake-control.json", JSON.stringify({ off: value, nonce }));
  for (let i = 0; i < 100; i++) {
    try {
      const ack = JSON.parse(await readFile(".scratch/fake-ack.json", "utf8"));
      if (ack.nonce === nonce) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("The fake module fixture did not acknowledge its switch.");
}

const owner = await context();
const page = await owner.newPage();
page.setDefaultTimeout(15000);
const post = (c, action, data) =>
  c.request.post(`/api/assistant/${action}`, { headers: { origin: config.origin }, data });
async function test(id, work) {
  await work();
  results.push({ id, ok: true });
  console.log(`Passed ${id}`);
}
try {
  // Drive every shipping checklist, including the capability-off check, using the platform vocabulary.
  const manifest = JSON.parse(await readFile("pramaan.kit.json", "utf8"));
  for (const journey of manifest.journeys.filter((j) => j.status === "ships-working")) {
    // Kit CI gives every journey its own throwaway database, so none may lean on another's data.
    await db.query("TRUNCATE app_users CASCADE");
    await db.query("DELETE FROM assistant_settings");
    await owner.clearCookies();
    if (journey.id === "capability-off") await off(true);
    const checklist = JSON.parse(await readFile(journey.checklist, "utf8"));
    await test(journey.id, async () => {
      for (const item of checklist.items)
        for (const step of item.steps) {
          if (step.enterAs === "owner") await page.goto(`/api/account/owner-pass?token=${pass()}`);
          else if (step.enterAs === "visitor") await owner.clearCookies();
          else if (step.goto) await page.goto(step.goto);
          else if (step.fill) await page.getByLabel(step.fill, { exact: true }).fill(step.value);
          else if (step.click)
            await page
              .getByRole("button", { name: step.click, exact: true })
              .or(page.getByRole("link", { name: step.click, exact: true }))
              .click();
          else if (step.expectText)
            await expect(page.getByText(step.expectText, { exact: false }).first()).toBeVisible();
          else if (step.expectHeading)
            await expect(
              page.getByRole("heading", { name: step.expectHeading, exact: true }),
            ).toBeVisible();
          else throw Error(`Unsupported checklist step ${JSON.stringify(step)}`);
        }
      await page.screenshot({ path: `.evidence/screens/${journey.id}.png`, fullPage: true });
    });
    if (journey.id === "capability-off") await off(false);
  }
  await page.goto(`/api/account/owner-pass?token=${pass()}`);
  await post(owner, "setup", { name: "Team guide", instructions: "Help our team in plain words." });
  // Owner-pass replay, expiry, signature, project, role, session and cross-site probes.
  await test("owner-pass-and-account-permissions", async () => {
    const token = pass();
    expect(
      (
        await owner.request.get(`/api/account/owner-pass?token=${token}`, { maxRedirects: 0 })
      ).status(),
    ).toBe(303);
    for (const t of [
      token,
      pass({ exp: Math.floor(Date.now() / 1000) - 1 }),
      pass({ project: "other" }),
      pass({ role: "admin" }),
      `${pass()}bad`,
    ])
      expect(
        (
          await owner.request.get(`/api/account/owner-pass?token=${t}`, { maxRedirects: 0 })
        ).status(),
      ).toBe(401);
    const anonymous = await context();
    expect((await anonymous.request.get("/api/assistant/state")).status()).toBe(401);
    expect(
      (
        await owner.request.post("/api/assistant/setup", {
          headers: { origin: "https://other.test" },
          data: { name: "Bad", instructions: "Bad" },
        })
      ).status(),
    ).toBe(403);
    await anonymous.close();
  });
  const member = await context();
  const mp = await member.newPage();
  mp.setDefaultTimeout(15000);
  await test("member-signup-and-team-access", async () => {
    await mp.goto("/");
    await mp.getByRole("button", { name: "Create an account", exact: true }).click();
    await mp.getByLabel("Email", { exact: true }).fill("member@example.test");
    await mp.getByLabel("Password", { exact: true }).fill("Member-password-12345");
    await mp.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(mp.getByText("Signed in as member@example.test.")).toBeVisible();
    expect((await member.request.get("/api/assistant/state")).status()).toBe(403);
    await page.goto("/team");
    await page.getByLabel("Member email").fill("member@example.test");
    await page.getByRole("button", { name: "Save team access" }).click();
    await expect(page.getByText("Team access saved.")).toBeVisible();
    await mp.goto("/chat");
    await expect(mp.getByRole("heading", { name: "Your conversations" })).toBeVisible();
  });
  await test("streamed-answers-and-persisted-history", async () => {
    await mp.getByLabel("Conversation title").fill("Private planning");
    await mp.getByRole("button", { name: "New conversation" }).click();
    await mp.getByLabel("Message", { exact: true }).fill("Help me plan");
    await mp.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(mp.getByText("Hello. How can I help your team?", { exact: true })).toBeVisible();
    await mp.reload();
    await mp.getByRole("button", { name: "Private planning" }).click();
    await expect(mp.getByText("Help me plan", { exact: true })).toBeVisible();
    await mp.screenshot({ path: ".evidence/screens/streamed-answers.png", fullPage: true });
  });
  await test("remember-view-forget-one-and-all", async () => {
    await mp.goto("/memory");
    await mp.getByLabel("Fact to remember").fill("Prefers short meetings");
    await mp.getByRole("button", { name: "Remember fact" }).click();
    await expect(mp.getByText("Prefers short meetings", { exact: true })).toBeVisible();
    await mp.goto("/chat");
    await mp.getByRole("button", { name: "Private planning" }).click();
    await mp.getByLabel("Message", { exact: true }).fill("What do you remember?");
    await mp.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      mp.getByText("Hello. I remember you prefer short meetings.", { exact: true }),
    ).toBeVisible();
    await mp.goto("/memory");
    mp.on("dialog", (d) => d.accept());
    await mp.getByRole("button", { name: "Forget this fact", exact: true }).click();
    await expect(mp.getByText("Prefers short meetings", { exact: true })).not.toBeVisible();
    await mp.getByLabel("Fact to remember").fill("A second private fact");
    await mp.getByRole("button", { name: "Remember fact" }).click();
    await expect(mp.getByText("A second private fact", { exact: true })).toBeVisible();
    await mp.getByRole("button", { name: "Forget everything", exact: true }).click();
    await expect(mp.getByRole("button", { name: "Check memory status" })).toBeVisible();
    await mp.getByRole("button", { name: "Check memory status" }).click();
    await expect(mp.getByText("Operation finished.", { exact: true })).toBeVisible();
    await expect(mp.getByText("A second private fact", { exact: true })).not.toBeVisible();
    await mp.screenshot({ path: ".evidence/screens/memory.png", fullPage: true });
  });
  let approvalId;
  await test("model-tool-approval-email-and-job-execution", async () => {
    await mp.goto("/chat");
    await mp.getByRole("button", { name: "Private planning" }).click();
    await mp.getByLabel("Message", { exact: true }).fill("Draft email");
    await mp.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      mp.getByText("Email is waiting for approval. Nothing has been sent.", { exact: true }),
    ).toBeVisible();
    await page.goto("/approvals");
    const article = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: "Review my proposal" }) });
    await expect(article.getByText("Please review the proposal.", { exact: true })).toBeVisible();
    approvalId = (
      await db.query(
        "SELECT id FROM assistant_approvals WHERE input->>'subject'='Review my proposal' ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0].id;
    expect(
      (await post(member, "approvals", { id: approvalId, decision: "approve" })).status(),
    ).toBe(403);
    await article.getByRole("button", { name: "Approve and send" }).click();
    await expect(article.getByText("Status: waiting")).toBeVisible();
    await article.getByRole("button", { name: "Check action status" }).click();
    await expect(article.getByText("Status: done")).toBeVisible();
    expect((await post(owner, "approvals", { id: approvalId, decision: "approve" })).status()).toBe(
      409,
    );
    await page.screenshot({ path: ".evidence/screens/approval-executed.png", fullPage: true });
  });
  await test("wallet-usage-and-activity", async () => {
    await page.goto("/usage");
    await expect(page.getByText("$12.50", { exact: true })).toBeVisible();
    await expect(page.getByText("$0.25", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
    expect((await member.request.get("/api/assistant/usage")).status()).toBe(403);
    expect(await page.locator("body").innerText()).not.toMatch(/hidden|provider_id/);
    await page.screenshot({ path: ".evidence/screens/usage.png", fullPage: true });
  });
  await test("admin-approval-and-owner-only-controls", async () => {
    await page.goto("/team");
    await page.getByLabel("Member email").fill("member@example.test");
    await page.getByLabel("Team role").selectOption("admin");
    await page.getByRole("button", { name: "Save team access" }).click();
    await expect(page.getByText("Team access saved.")).toBeVisible();
    const state = await (await member.request.get("/api/assistant/state")).json();
    expect(
      (
        await post(member, "email", {
          conversation: state.conversations[0].id,
          to: "recipient@example.test",
          subject: "Admin review",
          text: "Reviewed by an admin.",
        })
      ).status(),
    ).toBe(200);
    await mp.goto("/approvals");
    const item = mp
      .locator("article")
      .filter({ has: mp.getByRole("heading", { name: "Admin review" }) });
    await item.getByRole("button", { name: "Approve and send" }).click();
    await item.getByRole("button", { name: "Check action status" }).click();
    await expect(item.getByText("Status: done")).toBeVisible();
    expect(
      (
        await post(member, "team", { email: "shipping-member@example.test", role: "admin" })
      ).status(),
    ).toBe(403);
    expect(
      (await post(member, "setup", { name: "Changed", instructions: "Not allowed" })).status(),
    ).toBe(403);
    expect((await member.request.get("/api/assistant/usage")).status()).toBe(403);
  });
  await test("person-isolation-and-removed-access", async () => {
    const chats = await member.request.get("/api/assistant/state");
    const { conversations } = await chats.json();
    expect(
      (await owner.request.get(`/api/assistant/messages?id=${conversations[0].id}`)).status(),
    ).toBe(404);
    const stranger = await context();
    await stranger.request.post("/api/account/signup", {
      headers: { origin: config.origin },
      data: { email: "stranger@example.test", password: "Stranger-password-12345", role: "owner" },
    });
    const s = await stranger.request.get("/api/account/session");
    expect((await s.json()).user.role).toBe("member");
    expect((await stranger.request.get("/api/assistant/memories")).status()).toBe(403);
    await stranger.close();
    await page.goto("/team");
    await page.getByLabel("Member email").fill("member@example.test");
    await page.getByLabel("Remove team access").check();
    await page.getByRole("button", { name: "Save team access" }).click();
    await expect(page.getByText("Team access removed.")).toBeVisible();
    expect((await member.request.get("/api/assistant/state")).status()).toBe(403);
  });
  await test("capability-off-all-remote-journeys", async () => {
    await off(true);
    await page.goto("/memory");
    await expect(page.getByText("This capability is off.", { exact: false })).toBeVisible();
    await page.getByLabel("Fact to remember").fill("No dispatch");
    await page.getByRole("button", { name: "Remember fact" }).click();
    await expect(page.getByText("This capability is off.", { exact: false })).toBeVisible();
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Forget everything", exact: true }).click();
    await expect(page.getByText("This capability is off.", { exact: false })).toBeVisible();
    await page.goto("/chat");
    await page.getByLabel("Conversation title").fill("Owner notes");
    await page.getByRole("button", { name: "New conversation" }).click();
    await page.getByLabel("Message", { exact: true }).fill("No dispatch");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByText("This capability is off.", { exact: false })).toBeVisible();
    await page.getByLabel("To", { exact: true }).fill("recipient@example.test");
    await page.getByLabel("Subject", { exact: true }).fill("Off request");
    await page.getByLabel("Email text", { exact: true }).fill("Must wait");
    await page.getByRole("button", { name: "Request email approval" }).click();
    await expect(page.getByText("Email is waiting for approval.", { exact: false })).toBeVisible();
    await page.goto("/approvals");
    const item = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: "Off request" }) });
    await item.getByRole("button", { name: "Approve and send" }).click();
    await expect(page.getByText("This capability is off.", { exact: false })).toBeVisible();
    await page.goto("/usage");
    await expect(page.getByText("This capability is off.", { exact: false })).toBeVisible();
    await off(false);
    await page.goto("/approvals");
    const approved = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: "Off request" }) });
    await approved.getByRole("button", { name: "Retry approved action" }).click();
    await approved.getByRole("button", { name: "Check action status" }).click();
    await expect(approved.getByText("Status: done")).toBeVisible();
  });
  await test("mobile-layout", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/chat");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: ".evidence/screens/mobile.png", fullPage: true });
  });
  expect(errors).toEqual([]);
  await writeFile(
    ".evidence/walk.json",
    JSON.stringify({ ok: true, checks: results, consoleErrors: errors }, null, 2),
  );
} catch (e) {
  await page.screenshot({ path: ".evidence/screens/failure.png", fullPage: true });
  await writeFile(
    ".evidence/walk.json",
    JSON.stringify(
      { ok: false, checks: results, error: e.message, consoleErrors: errors },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await off(false);
  await browser.close();
  await db.end();
}
