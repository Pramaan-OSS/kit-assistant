# Activity log (`activity`)

What ran, what it cost, and what failed, with the next step. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/activity.json
```

It adds the files below, the shadcn `button`, `input`, `label`, `table`, `tabs`, `alert-dialog` and
`badge` components, and the `@pramaan/sdk` and `server-only` packages. Set `PRAMAAN_API_KEY` on the
server.

## Look

The block reads the Pramaan theme (`theme.json`). Install it once and load its fonts with
`pramaanFonts` on `<html>`; steps are in the repo README.

## Use

```tsx
import { ActivityLog } from "@/components/pramaan/activity/activity-log";

<ActivityLog />
```

No props. Put it behind your own sign-in: it shows your whole workspace's activity.

## What it shows

- **Calls:** newest first, 20 at a time ("Show more"). Each shows what ran in words ("Send an email"),
  when ("31 Oct, 8:03 PM"), the cost and a status pill: Done, Failed, Running, Waiting for a yes.
- **Filters:** what ran, how it went, and a from and to date.
- **A call's details:** when, the cost ("Nothing was charged" for a failure), a Copy reference
  control for the call, and for a failure what went wrong and **What to do next**, from the
  API's own message.
- **Webhook deliveries:** a tab that appears only where the API keeps delivery history: each event,
  when, how many tries, what your server answered, and for a failure what to do next.
- **Until the API lists each call**, the screen shows **daily totals** (day, what ran, calls, cost)
  from `GET /v1/usage`, says so, and drops the status filter, because totals have no status. It
  switches to the call list by itself when the route exists.

## Calls it makes

Server only, from `app/api/pramaan/activity/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `GET /api/pramaan/activity?capability=&status=&from=&to=&cursor=` | `GET /v1/calls` (proposed), else `GET /v1/usage` |
| `GET /api/pramaan/activity/{id}` | `GET /v1/calls/{id}` (proposed) |
| `GET /api/pramaan/activity/deliveries` | `GET /v1/webhook-deliveries` (proposed) |

The three proposed routes aren't in the Pramaan API yet. A 404 triggers the fallback; any other
refusal shows the API's own message.

Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open `/activity`.

## Files

| File | Part |
|---|---|
| `lib/pramaan/activity.ts` | server logic and types |
| `app/api/pramaan/activity/**` | route handlers |
| `components/pramaan/activity/activity-log.tsx` | the screen |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
