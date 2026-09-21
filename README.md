# dispatch-platform

Multi-tenant dispatch, retail and accounting platform. One codebase, one Supabase project per tenant —
tenants differ only by `NEXT_PUBLIC_CLIENT_*` environment variables, never by branching on a tenant
name in code.

Currently serving:

- **SimpliiTrash** ([simpliidash.ca](https://simpliidash.ca)) — bin rental hauler
- **BR Garden Center** ([brdash.ca](https://brdash.ca)) — garden centre; sells material and tools

## What it does

An order is the spine: one customer job is one order row, one trip, one invoice. It carries the bin
service and its material, holds stock when saved, appears on the dispatch board and in the driver app,
and is billed either immediately (prepaid) or on the monthly account invoice run.

**Operations** — dispatch board with drag-to-reorder, order CRUD and bin lifecycle, driver PWA with an
offline queue and sticky statuses.

**Business** — price book, counter till, invoice register, account invoicing, expenses, HST return and
a QuickBooks CSV/IIF export. Scoped to replace QuickBooks Desktop 2019 + Excel.

## Getting started

```bash
npm install
npm run dev
```

Copy `.env.local.example` to `.env.local` and fill in the Supabase and tenant variables. The full and
current list of tenant knobs is the table in [CLAUDE.md](CLAUDE.md) — `.env.local.example` is stale.

## Verification

There is no test suite. Before shipping:

```bash
npx tsc --noEmit && npm run build
```

Then exercise the route you changed. [CLAUDE.md](CLAUDE.md) documents the architecture, the coding
standards that keep the tenants from diverging, the database schema and the known defects.
