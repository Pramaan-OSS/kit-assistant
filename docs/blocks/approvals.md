# Approval inbox (`approvals`)

One place where a person sees every call waiting for their yes, and approves or declines it.
Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/approvals.json
```

The command adds the files below, the shadcn `button`, `badge`, `tabs`, `alert-dialog` and `card`
components (whatever style your app uses), and the `@pramaan/sdk` and `server-only` packages.
Then set `PRAMAAN_API_KEY` on the server, and edit `lib/pramaan/session.ts` to return the
signed-in person's Pramaan `member_id`.

## Look

The block reads the Pramaan theme (`theme.json`: colours, type, pills, rows, buttons). Install it
once and load its fonts (Geist, Fraunces, JetBrains Mono) with `pramaanFonts` on `<html>`; steps are
in the repo README. Without it the block still works in your own shadcn theme.

## Use

```tsx
import { ApprovalInbox } from "@/components/pramaan/approvals/approval-inbox";
import { ApprovalsBadge } from "@/components/pramaan/approvals/approvals-badge";

<nav>Approvals <ApprovalsBadge /></nav>
<ApprovalInbox pollMs={30_000} />
```

| Component | Prop | Default | What it does |
|---|---|---|---|
| `ApprovalInbox` | `pollMs?: number` | off | Re-checks the list this often. 30000 is a good choice. |
| `ApprovalsBadge` | `pollMs?: number` | `30000` | Count of waiting requests for a nav bar. Renders nothing at zero. |
| `ApprovalDetail` | `id`, `viewer`, `onDecided?` | | One request on its own, if you build your own list. |

## What it shows

- **Pending:** what, who asked, when, maximum price. Newest first.
- **Detail:** the exact inputs, the expected effect (the capability's own description, plus
  "can't be undone" for irreversible ones), when it expires, and the maximum price.
- **Approve / Decline:** each opens a confirm with the exact inputs and the maximum price.
  The confirm fires once; the decision carries its own `Idempotency-Key`; a second decision is
  refused by the API (409) and shown as "Already decided" with the API's message.
- **Expired or already decided:** shown as such, with no buttons. Expiry updates live.
- **Read-only:** a person who may not approve sees everything and no buttons. The server route
  refuses their decision too.
- **History:** the decisions made in this browser, each read back by id for its current state.
- **States:** loading, empty, error (the server's own message and next step), needs connection
  (no key), and a live status line for screen readers.

## Calls it makes

Server only, from `app/api/pramaan/approvals/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `GET /api/pramaan/approvals` | `GET /v1/members`, `GET /v1/approvals` |
| `GET /api/pramaan/approvals/{id}` | `GET /v1/members`, `GET /v1/approvals/{id}`, `GET /v1/capabilities/{capability}` |
| `POST /api/pramaan/approvals/{id}/decide` | `GET /v1/members`, `POST /v1/approvals/{id}/decide` |

Calls act as the viewer with `Pramaan-Member: <member_id>`.

**Live today:** Pramaan answers these approvals routes only for a member signed in to its
dashboard; a server key gets 403. Until Pramaan adds key access for a member, run
the block on the fake (`PRAMAAN_FAKE=1`).

## Files

| File | Part |
|---|---|
| `lib/pramaan/approvals.ts` | server logic for the three routes |
| `app/api/pramaan/approvals/**/route.ts` | route handlers |
| `components/pramaan/approvals/*` | inbox, detail, badge, history |
| `lib/pramaan/server.ts`, `session.ts`, `fake.ts`, `client.ts` | shared by every block |
| `components/pramaan/states.tsx`, `confirm-action.tsx` | shared by every block |
