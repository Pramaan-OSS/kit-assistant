"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Field } from "../ui";

type Owner = { id: string; email: string | null; role: string };

/**
 * The owner area. Pramaan's "Open as owner" signs the founder in here through /api/account/owner-pass; the
 * first time, they choose the email and password to sign in with directly, without Pramaan.
 */
export default function OwnerArea() {
  const [owner, setOwner] = useState<Owner | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/account/session", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { user: Owner }).user : null,
      )
      .then(
        (user) => setOwner(user?.role === "owner" ? user : null),
        () => setOwner(null),
      );
  }, []);
  async function post(action: string, input: object) {
    const response = await fetch(`/api/account/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(owner ? { "x-app-user": owner.id } : {}) },
      body: JSON.stringify(input),
    });
    const result = (await response.json()) as { user?: Owner; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Please try again.");
    return result;
  }
  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const { user } = await post("owner", { email, password });
      setOwner(user ?? null);
      setPassword("");
      setNotice({
        tone: "success",
        text: "Saved. You can now sign in with this email and password.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Owner area</h1>
      {owner === undefined ? (
        <p className="text-muted">One moment…</p>
      ) : owner === null ? (
        <p className="text-muted">
          This page is for the app's owner. Open the app as its owner from Pramaan, or{" "}
          <a href="/" className="text-accent underline-offset-4 hover:underline">
            sign in
          </a>{" "}
          with the owner's email and password.
        </p>
      ) : (
        <>
          <p className="text-muted">
            {owner.email
              ? `You're signed in as the owner, ${owner.email}.`
              : "You're signed in as the owner. Choose the email and password you will sign in with here, without Pramaan."}
          </p>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field
              label="Owner email"
              id="owner-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
            <Field
              label="Password"
              id="owner-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            <Button type="submit" variant="primary" disabled={busy}>
              {owner.email ? "Change sign-in" : "Save sign-in"}
            </Button>
          </form>
          <Button
            disabled={busy}
            onClick={() => void post("signout", {}).finally(() => window.location.assign("/"))}
          >
            Sign out
          </Button>
        </>
      )}
      {notice && <Alert title={notice.text} tone={notice.tone} />}
    </main>
  );
}
