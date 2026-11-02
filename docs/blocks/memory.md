# Memory viewer (`memory`)

"What the assistant remembers": your own memories and, for admins, your organisation's. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/memory.json
```

It adds the files below, the shadcn `button`, `tabs`, `alert-dialog`, `input`, `label` and `badge`
components, and the `@pramaan/sdk` and `server-only` packages. Set `PRAMAAN_API_KEY` on the server.
Optionally set `PRAMAAN_MEMORY_NAMESPACE` (default `assistant`): the name of the memory set.

Then edit `lib/pramaan/session.ts`: `currentEndUserRef` must return your signed-in user's id (an id,
not an email or a name). **That is whose memories the screen shows; the browser never says.**
`currentMemberId` decides who is an admin for the Organisation tab.

## Look

The block reads the Pramaan theme (`theme.json`). Install it once and load its fonts with
`pramaanFonts` on `<html>`; steps are in the repo README.

## Use

```tsx
import { MemoryViewer } from "@/components/pramaan/memory/memory-viewer";

<MemoryViewer approvalsHref="/approvals" />
```

| Prop | Default | What it does |
|---|---|---|
| `approvalsHref` | `/` | Where your approvals inbox lives. Deleting waits there. |

## What it shows

- **My memories:** search, the list newest first ("Show more" pages it), Delete on each, and
  "Forget everything". Each delete asks first and shows the exact memory.
- **Recent changes:** what was remembered, updated or forgotten, and when.
- **Organisation** (admins only): facts suggested for the whole team. Approve shares one with the
  team, Reject drops it, "Check first" marks one that may contradict what the team knows. Facts the
  assistant added on its own can be acknowledged or removed. Anyone else is told only admins review
  these and sees none.
- An admin never sees another member's personal memories: the personal list always uses the
  signed-in person, and the screen offers no way to pick someone else.
- The empty state says memories come from chats and that deleting a chat deletes them.
- Deleting is permanent, so Pramaan holds the call for a member's yes. The screen shows "Waiting for
  approval" and links to the inbox; the memory goes once it is approved.

## Calls it makes

Server only, from `app/api/pramaan/memory/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `GET /api/pramaan/memory?q=&cursor=` | `memory.items.list`, or `memory.items.search` with `q` |
| `DELETE /api/pramaan/memory/{ref}` | `memory.item.delete` with `confirm: true` |
| `POST /api/pramaan/memory/forget` | `memory.scope.delete` for the person, with `confirm: true` |
| `GET /api/pramaan/memory/changes` | `memory.history.list` |
| `GET /api/pramaan/memory/org` | `GET /v1/internal/memory/admin/queue` |
| `POST /api/pramaan/memory/org/decide` | `POST /v1/internal/memory/admin/decide` |

Limits: the organisation routes open only to a signed-in admin session today, so that
tab runs on the fake until Pramaan opens them to keys. "Forget everything" uses
`memory.scope.delete`; `memory.forget` works on a different store (documents, by description).

Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open `/memory`.

## Files

| File | Part |
|---|---|
| `lib/pramaan/memory.ts` | server logic and types |
| `app/api/pramaan/memory/**` | route handlers |
| `components/pramaan/memory/memory-viewer.tsx` | the screen |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
