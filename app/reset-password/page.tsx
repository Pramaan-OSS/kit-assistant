import type { Metadata } from "next";
import { ResetForm } from "./form";

// #1250: the reset link's token is in this page's address; never pass it on as a referrer.
export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default function ResetPassword() {
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
      <ResetForm />
    </main>
  );
}
