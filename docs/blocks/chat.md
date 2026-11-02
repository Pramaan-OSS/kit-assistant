# Chat (`chat`)

A chat with an assistant, inside your app. Replies stream in as they are written. When the
assistant wants to do something for the person, it runs on the server, and anything that needs a
yes waits in the approvals inbox (the `approvals` block) before the chat carries on. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/chat.json
```

It adds the files below, the shadcn `button`, `textarea` and `label` components, and the
`@pramaan/sdk` and `server-only` packages. No other dependency: the reply stream is read with the
browser's own `fetch`. Set `PRAMAAN_API_KEY` on the server. Install the `approvals` block too if
your assistant can send or change anything, so the person has somewhere to say yes.

## Look

The block reads the Pramaan theme (`theme.json`). Install it once and load its fonts with
`pramaanFonts` on `<html>`; steps are in the repo README.

## Use

```tsx
import { Chat } from "@/components/pramaan/chat/chat-panel";

<Chat approvalsHref="/approvals" />
```

| Prop | Default | What it does |
|---|---|---|
| `approvalsHref` | `/` | where your approvals inbox lives; the "approvals inbox" link points here |
| `pollMs` | 2000 | how often an action that is waiting for a yes is checked |

Edit `lib/pramaan/chat-tools.ts` to say how the assistant talks (`CHAT_SYSTEM`), which model size
it uses (`CHAT_MODEL`: `fast`, `balanced` or `best`) and what it may do (`CHAT_TOOLS`). **The
browser can only ask for a tool by name**; it never sends a tool, a system message or a model, so a
visitor can't make the assistant call anything you didn't list.

Who is signed in comes from `lib/pramaan/session.ts`, the same hook every block uses. Every reply
costs credit, so nobody signed in gets "Sign in to chat." and no call is made. Calls act as the
signed-in member, so their role and spending limit apply.

## What it shows

- The conversation, with a Stop button that also stops the reply (and its cost).
- What each reply cost, in dollars.
- For each action the assistant asks to run: its plain name, the exact details, and a status:
  working, **waiting for a yes** (with a link to the inbox), done, or didn't run (with the reason).
  A refusal is told to the assistant too, so it can explain it in its own words.
- A conversation is kept in the browser only (the model keeps nothing between calls), up to 60
  messages, and up to 5 steps of the assistant using actions per message.

## Calls it makes

Server only, from `app/api/pramaan/chat/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `POST /api/pramaan/chat` | `llm.chat`, asked for as a stream |
| `POST /api/pramaan/chat/tool` | the action named in `CHAT_TOOLS`; one idempotency key per click |
| `GET /api/pramaan/chat/tool?job=` | `GET /v1/jobs/{id}` for an action that waited for a yes |

Only the stream's known events (text, tool calls, usage, done, error) reach the browser. Which
model answers is Pramaan's routing, not this block's. Try it on the fake with `PRAMAAN_FAKE=1 pnpm
dev` and open `/chat`: say "Email sam@example.com" to see an action wait for a yes.

## Files

| File | Part |
|---|---|
| `lib/pramaan/chat-tools.ts` | how it talks and what it may do (edit this) |
| `lib/pramaan/chat.ts` | server logic |
| `app/api/pramaan/chat/route.ts`, `app/api/pramaan/chat/tool/route.ts` | route handlers |
| `components/pramaan/chat/chat-panel.tsx` | the chat (not `chat.tsx`: it would share a name with `lib/pramaan/chat.ts`, and the shadcn CLI would point their imports at each other) |
| `components/pramaan/chat/stream.ts` | reads the reply stream |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
