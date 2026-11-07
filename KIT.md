# Team assistant

One business configures an assistant. Public sign-up creates an unassigned member. Only the owner can grant team access and admin roles. Every conversation and memory scope belongs to the signed-in person, including when an owner uses the app.

## Where things live

- `app/page.tsx`: account sign-in, sign-up and links.
- `app/owner/page.tsx`: starter owner-pass landing and owner credentials.
- `app/chat/page.tsx`: private conversations and email drafts.
- `app/memory/page.tsx`: view, remember and confirmed forgetting.
- `app/team/page.tsx`: owner setup and membership controls.
- `app/approvals/page.tsx`: owner/admin review and execution status.
- `app/usage/page.tsx`: owner balance, spend and activity.
- `app/assistant-screen.tsx`: shared screen controls and stream reader.
- `app/assistant.css`: local styles over the starter theme tokens.
- `app/api/account/[action]/route.ts`: unchanged starter account handler.
- `app/api/assistant/[action]/route.ts`: session check, same-origin writes and bounded JSON input.
- `app/api/health/route.ts`: unchanged platform health route.
- `lib/accounts.ts`: immutable starter accounts, sessions and owner passes.
- `lib/runtime.ts`: one database pool shared by accounts and assistant storage.
- `lib/email.ts`: starter verification and reset mail module transport.
- `lib/assistant/pramaan.ts`: single assistant Pramaan HTTP client through the mounted module socket. No direct external network fallback.
- `lib/assistant/service.ts`: role checks, scoped queries, remembering, conversations and approval state machine.
- `lib/assistant/browser.ts`: same-origin browser JSON requests.
- `src/db/migrations/0001` through `0004`: immutable starter migrations, including verification and reset proofs.
- `src/db/migrations/0100-assistant.sql`: assistant settings, members, private conversations, messages, approvals and memory operations.
- `src/db/migrations/0101-release-member.sql`: deleting an account clears `decided_by` on requests it decided; each request keeps its status and job reference.
- `blocks.lock.json`: each published block this kit adapts, at its commit, with the SHA-256 of every source file and a note on how it was adapted. `docs/blocks/`: the blocks' READMEs and licence, kept byte for byte. The adapted code lives in `lib/assistant` and `app`.
- `scripts/fake-door.mjs`: standalone test module service, never loaded by production routes.
- `scripts/local-server.mjs`: test-only server on port 3412 with the fake socket.
- `scripts/walk.mjs`: headless browser checklists and enabled/disabled capability journeys.
- `lib/assistant/assistant.pg.spec.ts`: real Postgres tests and fake socket integration.
- `scripts/check-blocks.mjs`: checks the kept block files, and every recorded hash against a blocks checkout (`OSS_BLOCKS_ROOT`).
- `scripts/check-contract.mjs`: invokes the platform's own contract, licence, secret and dependency gates read-only.

## Add a field

For an assistant description, add `0102-assistant-description.sql` with an additive `ALTER TABLE assistant_settings ADD COLUMN description text NOT NULL DEFAULT ''`. Add its bounded input and parameterised query in `lib/assistant/service.ts`, then its labelled form field in `app/assistant-screen.tsx`. Test that the owner can save it, a member cannot, and existing settings survive the migration. Never edit starter or applied migrations.

## Add a page

Add `app/reports/page.tsx` and `app/reports/pramaan.feature.json`, following the existing `routes` and `nav` lists. Run `pnpm generate`. Check the role on the server in its API handler before any query or module call; hiding a button does not grant or deny access. Register the page in `pramaan.kit.json`, and add a headless journey if it ships working.

## Add a role

Roles live in `app_users.role`. The owner grants `member` or `admin` through the team endpoint; public sign-up always creates `member` and never grants team membership. Reuse `requireUser` and `requireRole` from the starter; assistant team roles are checked in `service.ts` as well as current membership. New roles need a server allowlist, schema migration if required, manifest entries and permission tests. Never trust role, user or scope supplied by the browser. Owners cannot read another person's conversations or memories.

## Journeys that ship working

- `owner-settings`: owner-pass entry and direct owner sign-in setup.
- `configure-assistant`: owner saves the name and instructions.
- `team-access`: grants an existing account team membership.
- `conversation-history`: creates a private named conversation and opens it.
- `approval-decline`: starts a conversation, requests an email, reviews it and declines without dispatch.
- `account-signin`: creates a member account, signs out and signs back in.
- `capability-off`: explains that remote memory is disabled.

`streamed-answers`, `remember-and-forget`, `approved-email`, `approval-execution` and `wallet-and-activity` are fully implemented and exercised end to end with the fake module service. They remain `needs-capability` because the platform disables capabilities by default and some transport paths are missing; see GAPS.md. Never claim the fake service proves live capability delivery.

## Approval and retry rules

An email draft is immutable after creation. The owner/admin reviews those exact fields; the request id is its persistent dispatch key. Declined or expired requests never execute. A definite capability-off refusal keeps it approved for retry under the same key. Approving holds no database connection or row lock during the module call: the row is marked approved, the call runs, then the outcome is recorded, each in its own short statement. The module runs one call per key, so a second click on a running call is refused as uncertain until the first result lands and replaces that. A running job is polled by its locally stored job reference. An unknown delivery outcome is held for reconciliation and cannot be blindly retried. A completed request cannot execute twice. Private memory operations have persistent keys and locally owned job references.

## Run and check

Use Node 24.18.0 and pnpm 11.15.1. Install with `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile`. Set DATABASE_URL, SESSION_SECRET (at least 32 characters), PRAMAAN_PROJECT_ID and APP_ORIGIN in your shell; never commit them. Run `pnpm db:migrate`, `pnpm build`, then `pnpm start --port 3412`. For ordinary development use `pnpm dev --port 3412`.

For a disposable database, use postgres:16-alpine with 192 MiB RAM and 0.5 CPUs, then run migrations before `pnpm test`. Tests deliberately fail without a real database. Test files run sequentially. The build sets CIRCLE_NODE_TOTAL=2 so Next uses one page worker, and RAYON_NUM_THREADS=1 bounds compiler parallelism; this keeps the build inside the kit memory budget without changing protected config. For browser checks, run `node scripts/local-server.mjs` with DATABASE_URL set, then `pnpm walk`. This uses fake calls only and resets that test database. Never point the walk at customer data.

Run lint from a fresh git worktree, since the starter lint scans every file and local ignored tool folders are deliberately excluded only by .gitignore, never by editing biome.json.
