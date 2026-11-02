"use client";
import { useState } from "react";
import { Alert, Button, Field } from "../ui";

/** The reset link's form: the token from the address, a new password, then signed in on the home page. */
export function ResetForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const token = new URLSearchParams(window.location.search).get("token") ?? "";
      const response = await fetch("/api/account/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Please try again.");
      window.location.assign("/");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
      setBusy(false);
    }
  }
  return (
    <>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label="New password"
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
        <Button type="submit" variant="primary" disabled={busy}>
          Save new password
        </Button>
      </form>
      {error && <Alert title={error} tone="error" />}
    </>
  );
}
