"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, post } from "../lib/assistant/browser";

type Chat = { id: string; title: string };
type Message = { id: string; role: string; content: string };
type State = {
  user: { role: string };
  settings: { name: string; instructions: string } | null;
  conversations: Chat[];
};
type Approval = {
  id: string;
  input: { to: string; subject: string; text: string };
  status: string;
  expires_at: string;
};
type Usage = {
  balanceMicro: number;
  calls: number;
  spendMicro: number;
  activity: { status: string; createdAt: string }[];
};
export function AssistantScreen({
  view,
}: {
  view: "chat" | "memory" | "team" | "approvals" | "usage";
}) {
  const [state, setState] = useState<State>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [partial, setPartial] = useState("");
  const [memories, setMemories] = useState<{ ref: string; text: string }[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [team, setTeam] = useState<{ email: string; role: string }[]>([]);
  const [usage, setUsage] = useState<Usage>();
  const [operation, setOperation] = useState("");
  const retryKeys = useRef(new Map<string, string>());
  function requestKey(action: string, value: string) {
    const name = JSON.stringify([action, value]);
    let key = retryKeys.current.get(name);
    if (!key) {
      key = crypto.randomUUID();
      retryKeys.current.set(name, key);
    }
    return key;
  }
  function finished(action: string, value: string) {
    retryKeys.current.delete(JSON.stringify([action, value]));
  }
  const load = useCallback(async () => {
    const s = await api<State>("/api/assistant/state");
    setState(s);
    if (view === "memory")
      setMemories((await api<{ results: typeof memories }>("/api/assistant/memories")).results);
    if (view === "approvals")
      setApprovals((await api<{ results: Approval[] }>("/api/assistant/approvals")).results);
    if (view === "team")
      setTeam((await api<{ results: typeof team }>("/api/assistant/team")).results);
    if (view === "usage") setUsage(await api<Usage>("/api/assistant/usage"));
  }, [view]);
  useEffect(() => {
    load().catch((e) => setNotice(e.message));
  }, [load]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    setSelected(id);
    setMessages(
      (await api<{ results: Message[] }>(`/api/assistant/messages?id=${encodeURIComponent(id)}`))
        .results,
    );
  }
  async function remember(fact: string) {
    const r = await post<{ operation: string; job_id?: string }>("remember", {
      fact,
      key: requestKey("remember", fact),
    });
    finished("remember", fact);
    if (r.job_id) setOperation(r.operation);
    setNotice(r.job_id ? "Remembering is in progress. Check its status." : "Remembered.");
    await load();
  }
  async function forget(ref?: string) {
    const r = await post<{ operation: string; job_id?: string }>("forget", {
      ref,
      all: !ref,
      confirm: true,
      key: requestKey("forget", ref ?? "all"),
    });
    finished("forget", ref ?? "all");
    if (r.job_id) setOperation(r.operation);
    setNotice(r.job_id ? "Forgetting is in progress. Check its status." : "Forgotten.");
    await load();
  }
  async function send(message: string) {
    const response = await fetch("/api/assistant/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: selected, message, key: crypto.randomUUID() }),
    });
    if (!response.ok) {
      const e = await response.json();
      throw new Error(e.error);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No reply was returned.");
    let buffer = "";
    let answer = "";
    const decoder = new TextDecoder();
    setPartial("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content: message }]);
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = /^event: (\S+)/.exec(frame)?.[1];
        const raw = frame
          .split("\n")
          .find((l) => l.startsWith("data: "))
          ?.slice(6);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (event === "text_delta") {
          answer += data.text;
          setPartial(answer);
        }
        if (event === "error") throw new Error(data.message);
      }
    }
    setPartial("");
    await open(selected);
  }
  const titles = {
    chat: "Your conversations",
    memory: "What it remembers",
    team: "Team and setup",
    approvals: "Approvals",
    usage: "Usage and balance",
  };
  const isAdmin = state && ["owner", "admin"].includes(state.user.role);
  return (
    <main className="assistant">
      <p className="eyebrow">{state?.settings?.name ?? "Assistant"}</p>
      <h1>{titles[view]}</h1>
      <nav aria-label="Assistant pages">
        <Link href="/chat">Chat</Link>
        <Link href="/memory">Memory</Link>
        <Link href="/approvals">Approvals</Link>
        <Link href="/team">Team and setup</Link>
        <Link href="/usage">Usage</Link>
        <Link href="/">Account</Link>
      </nav>
      <p role="status" aria-live="polite">
        {notice}
      </p>
      {!state && (
        <p>
          <Link href="/">Sign in</Link>, or ask the owner for team access.
        </p>
      )}
      {state && view === "chat" && (
        <>
          {!state.settings && <p>The owner needs to set up the assistant first.</p>}
          <section>
            <h2>Conversations</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  const c = await post<Chat>("conversations", { title: f.get("title") });
                  await load();
                  await open(c.id);
                });
              }}
            >
              <label>
                Conversation title
                <input name="title" required maxLength={100} />
              </label>
              <button type="submit" disabled={busy}>
                New conversation
              </button>
            </form>
            <div className="links">
              {state.conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => open(c.id))}
                  aria-pressed={selected === c.id}
                >
                  {c.title}
                </button>
              ))}
            </div>
          </section>
          {selected && (
            <>
              <section aria-label="Messages">
                <h2>Conversation</h2>
                {messages.map((m) => (
                  <p key={m.id} className="message">
                    <strong>{m.role === "user" ? "You" : "Assistant"}</strong>
                    <span>{m.content}</span>
                  </p>
                ))}
                {partial && (
                  <p role="status" aria-label="Reply in progress" className="message">
                    {partial}
                  </p>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const form = e.currentTarget;
                    void run(async () => {
                      await send(String(f.get("message")));
                      form.reset();
                    });
                  }}
                >
                  <label>
                    Message
                    <textarea name="message" required maxLength={10000} />
                  </label>
                  <button type="submit" disabled={busy || !state.settings}>
                    {busy ? "Working…" : "Send message"}
                  </button>
                </form>
              </section>
              <section>
                <h2>Draft an email</h2>
                <p>The owner or an admin reviews the exact message before it can be sent.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      const r = await post<{ message: string }>("email", {
                        conversation: selected,
                        ...Object.fromEntries(f),
                      });
                      setNotice(r.message);
                    });
                  }}
                >
                  <label>
                    To
                    <input name="to" type="email" required />
                  </label>
                  <label>
                    Subject
                    <input name="subject" required maxLength={200} />
                  </label>
                  <label>
                    Email text
                    <textarea name="text" required maxLength={10000} />
                  </label>
                  <button type="submit" disabled={busy}>
                    Request email approval
                  </button>
                </form>
              </section>
            </>
          )}
        </>
      )}
      {state && view === "memory" && (
        <section>
          <h2>Your private facts</h2>
          <p>
            Only you can view and forget these facts. Remembered facts help answer future messages.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(() => remember(String(f.get("fact"))));
            }}
          >
            <label>
              Fact to remember
              <textarea name="fact" required maxLength={2000} />
            </label>
            <button type="submit" disabled={busy}>
              Remember fact
            </button>
          </form>
          <ul>
            {memories.map((m) => (
              <li key={m.ref}>
                <p>{m.text}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Permanently forget this fact?"))
                      void run(() => forget(m.ref));
                  }}
                >
                  Forget this fact
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Permanently forget everything remembered about you?"))
                void run(() => forget());
            }}
          >
            Forget everything
          </button>
          {operation && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await post<{ status: string }>("operation-status", { key: operation });
                  setNotice(
                    r.status === "done"
                      ? "Operation finished."
                      : r.status === "failed"
                        ? "The operation failed."
                        : "Operation is still waiting.",
                  );
                  await load();
                })
              }
            >
              Check memory status
            </button>
          )}
        </section>
      )}
      {state &&
        view === "approvals" &&
        (isAdmin ? (
          <section>
            <h2>Review before sending</h2>
            <button type="button" disabled={busy} onClick={() => void run(load)}>
              Refresh requests
            </button>
            {approvals.map((a) => (
              <article key={a.id}>
                <h3>{a.input.subject}</h3>
                <p>To: {a.input.to}</p>
                <p className="email-body">{a.input.text}</p>
                <p>Status: {a.status}</p>
                <p>Expires: {new Date(a.expires_at).toLocaleString()}</p>
                {["pending", "approved"].includes(a.status) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await post<{ message: string }>("approvals", {
                          id: a.id,
                          decision: "approve",
                        });
                        setNotice(r.message);
                        await load();
                      })
                    }
                  >
                    {a.status === "approved" ? "Retry approved action" : "Approve and send"}
                  </button>
                )}
                {a.status === "pending" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await post<{ message: string }>("approvals", {
                          id: a.id,
                          decision: "deny",
                        });
                        setNotice(r.message);
                        await load();
                      })
                    }
                  >
                    Decline
                  </button>
                )}
                {a.status === "waiting" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await post("approval-status", { id: a.id });
                        await load();
                      })
                    }
                  >
                    Check action status
                  </button>
                )}
                {a.status === "unknown" && (
                  <p>
                    The result is uncertain. Ask the owner to reconcile this request before any
                    retry.
                  </p>
                )}
              </article>
            ))}
          </section>
        ) : (
          <p>Only the owner or an admin can review requests.</p>
        ))}
      {state && view === "team" && (
        <>
          {state.user.role === "owner" ? (
            <section>
              <h2>Assistant setup</h2>
              <form
                key={state.settings?.name}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    await post("setup", Object.fromEntries(f));
                    await load();
                    setNotice("Assistant saved.");
                  });
                }}
              >
                <label>
                  Assistant name
                  <input name="name" defaultValue={state.settings?.name} required maxLength={80} />
                </label>
                <label>
                  Instructions
                  <textarea
                    name="instructions"
                    defaultValue={state.settings?.instructions}
                    required
                    maxLength={4000}
                  />
                </label>
                <button type="submit" disabled={busy}>
                  Save assistant
                </button>
              </form>
              <h2>Team access</h2>
              <p>
                Add someone after they create an account. Removing access takes effect on their next
                request.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    const r = await post<{ message: string }>("team", {
                      ...Object.fromEntries(f),
                      remove: f.get("remove") === "on",
                    });
                    await load();
                    setNotice(r.message);
                  });
                }}
              >
                <label>
                  Member email
                  <input name="email" type="email" required />
                </label>
                <label>
                  Team role
                  <select name="role">
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label className="check">
                  <input name="remove" type="checkbox" />
                  Remove team access
                </label>
                <button type="submit" disabled={busy}>
                  Save team access
                </button>
              </form>
            </section>
          ) : (
            <p>Only the owner can change setup or team access.</p>
          )}
          <section>
            <h2>Team members</h2>
            {team.map((m) => (
              <p key={m.email}>
                {m.email} · {m.role}
              </p>
            ))}
          </section>
        </>
      )}
      {state && view === "usage" && state.user.role !== "owner" && (
        <p>Only the owner can view usage.</p>
      )}
      {state && view === "usage" && state.user.role === "owner" && (
        <section>
          <h2>Workspace usage</h2>
          <button type="button" disabled={busy} onClick={() => void run(load)}>
            Refresh usage
          </button>
          {usage && (
            <>
              <dl>
                <dt>Balance</dt>
                <dd>${(usage.balanceMicro / 1000000).toFixed(2)}</dd>
                <dt>Total calls</dt>
                <dd>{usage.calls}</dd>
                <dt>Spend</dt>
                <dd>${(usage.spendMicro / 1000000).toFixed(2)}</dd>
              </dl>
              <h3>Recent activity</h3>
              {usage.activity.map((a) => (
                <p key={a.createdAt}>
                  {a.status} · {new Date(a.createdAt).toLocaleString()}
                </p>
              ))}
            </>
          )}
        </section>
      )}
    </main>
  );
}
