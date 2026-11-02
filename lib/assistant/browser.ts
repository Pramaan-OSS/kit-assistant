"use client";
export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok)
    throw new Error(typeof body.error === "string" ? body.error : "Please try again.");
  return body;
}
export const post = <T = unknown>(action: string, input: unknown) =>
  api<T>(`/api/assistant/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
