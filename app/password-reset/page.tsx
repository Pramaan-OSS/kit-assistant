"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../lib/assistant/browser";
export default function ResetRequest() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="workspace">
      <h1>Reset your password</h1>
      <p>A reset link needs email to be enabled with a configured sender.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            const result = await api<{ message: string }>("/api/account/reset-request", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email: f.get("email") }),
            });
            setMessage(result.message);
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <button type="submit" disabled={busy}>
          Request reset link
        </button>
      </form>
      <p role="status">{message}</p>
      <Link href="/">Back to sign in</Link>
    </main>
  );
}
