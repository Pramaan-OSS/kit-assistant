# Wallet and usage (`wallet`)

Balance, top-up and spend, inside your own app. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/wallet.json
```

It adds the files below, the shadcn `button`, `alert-dialog`, `badge` and `table` components, and
the `@pramaan/sdk` and `server-only` packages. Set `PRAMAAN_API_KEY` on the server. Optionally set
`PRAMAAN_WALLET_URL` to your own add-credit page (default: the customer app's wallet page).

## Look

The block reads the Pramaan theme (`theme.json`: colours, type, pills, rows, buttons). Install it
once and load its fonts (Geist, Fraunces, JetBrains Mono) with `pramaanFonts` on `<html>`; steps are
in the repo README. Without it the block still works in your own shadcn theme.

## Use

```tsx
import { Wallet, WalletCard, UsagePanel, TopUpButton, CustomerCreditsCard } from "@/components/pramaan/wallet/wallet-panel";

<Wallet lowBalanceMicro={5_000_000} pollMs={30000} />   {/* card + usage */}
<WalletCard />                                          {/* balance and top-up only */}
<CustomerCreditsCard customerId="cus_123" />              {/* one of your own customers */}
```

| Component | Prop | Default | What it does |
|---|---|---|---|
| `Wallet`, `WalletCard` | `lowBalanceMicro` | `5000000` ($5.00) | Warn below this balance (micro-USD) |
| `Wallet`, `WalletCard` | `pollMs` | off | Re-read the balance this often |
| `TopUpButton` | `href`, `label?` | | A link button that opens the add-credit page in a new tab |
| `CustomerCreditsCard` | `customerId` | | A customer's prepaid credit (`billing.credits.balance`), for apps that bill their own users |

## What it shows

- **Balance card:** the balance you can spend now, credit set aside for running requests, spent
  today, the daily cap, and a top-up button. A low or empty balance shows a warning.
- **Usage:** spend by day (a bar for every day, even quiet ones) for the last 7 or 30 days; spend
  by what it was spent on, biggest first; the latest activity with calls and cost.
- **Money** is dollars to 2 decimals (`$0.91`, not `$0.905219`); under one cent reads "under $0.01".
- **A low-balance refusal anywhere in the app** can open this block's top-up: the shared
  `ErrorState` shows an "Add credit" link for any refusal that carries one. Pass `walletHref` to
  point it at your wallet page, for example `<MissionRunner walletHref="/wallet?topup=1" />` or
  `<ErrorState error={e} walletHref="/wallet?topup=1" />`. The wallet page opened with `?topup=1`
  says the request needed more credit and focuses the button.
- States: loading, empty (no usage yet), error (the server's own message and next step), and the
  needs-connection state when no key is set.

## Calls it makes

Server only, from `app/api/pramaan/wallet/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `GET /api/pramaan/wallet` | `GET /v1/balance` |
| `GET /api/pramaan/wallet/usage?days=7` | `GET /v1/usage?from=&to=` |
| `GET /api/pramaan/wallet/customers/{id}` | `POST /v1/capabilities/billing.credits.balance` |

Two limits: no route returns the top-up link unless a call was refused, so it comes
from `PRAMAAN_WALLET_URL`; and `GET /v1/usage` has one row per superpower per day, not one per call,
so "latest activity" lists the latest rows.

Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and open `/wallet`.

## Files

| File | Part |
|---|---|
| `lib/pramaan/wallet.ts` | server logic and types |
| `app/api/pramaan/wallet/**` | route handlers |
| `components/pramaan/wallet/wallet-panel.tsx` | the components |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
