"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/assistant/browser";

type User = { id: string; email: string | null; role: string };
export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState("signin");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ user: User }>("/api/account/session").then(
      (r) => setUser(r.user),
      () => {},
    );
  }, []);
  return (
    <main className="workspace">
      <p className="eyebrow">Your team’s assistant</p>
      <h1>Assistant</h1>
      <p>A private place to ask, remember and review actions before they run.</p>
      {user ? (
        <section>
          <p>Signed in{user.email ? ` as ${user.email}` : " as the app owner"}.</p>
          <div className="links">
            <Link href="/chat">Open assistant</Link>
            <Link href="/memory">What it remembers</Link>
            <Link href="/approvals">Approvals</Link>
            {user.role === "owner" && (
              <>
                <Link href="/team">Team and setup</Link>
                <Link href="/usage">Usage and balance</Link>
                <Link href="/owner">Owner settings</Link>
              </>
            )}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/api/account/signout", {
                  method: "POST",
                  headers: { "content-type": "application/json", "x-app-user": user.id },
                  body: "{}",
                });
                setUser(null);
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign out
          </button>
        </section>
      ) : (
        <section>
          <h2>{mode === "signup" ? "Create an account" : "Sign in"}</h2>
          <p>New accounts stay private until a workspace owner adds them.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setMessage("");
              try {
                const r = await api<{ user: User }>(`/api/account/${mode}`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
                });
                setUser(r.user);
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required maxLength={254} />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={12}
              />
            </label>
            <button type="submit" disabled={busy}>
              {mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>
          <button type="button" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
            {mode === "signup" ? "Use an existing account" : "Create an account"}
          </button>
          <p>
            <Link href="/password-reset">Forgot your password?</Link>
          </p>
        </section>
      )}
      <p role="status">{message}</p>
    </main>
  );
}
