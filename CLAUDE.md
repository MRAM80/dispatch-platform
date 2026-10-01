@AGENTS.md

# Project: SimpliiTrash / BR Garden Center Dispatch Platform

Multi-tenant dispatch + retail + accounting SaaS. **One codebase, one Supabase project per tenant.**
Tenants differ only by `NEXT_PUBLIC_CLIENT_*` env vars — never by branching on a tenant name in code.

- SimpliiTrash → simpliidash.ca — bin rental hauler, bin numbers matter
- BR Garden Center → brdash.ca — garden centre; sells material and tools, does **not** track bin numbers

The product is deliberately scoped to **replace QuickBooks Desktop 2019 + Excel** for BR: price book,
counter till, invoice register, expenses, HST return, and a QuickBooks export for the accountant.

---

## Stack

| | |
|---|---|
| Framework | Next.js **16.2.2** (App Router), React **19.2.4** |
| Data | Supabase — browser client only (`@/lib/supabase/client`) |
| Styling | Tailwind CSS **v4** — no `tailwind.config.*`; all config lives in `app/globals.css` |
| Charts | `recharts`, always via `next/dynamic` with `{ ssr: false }` |
| Push | `web-push` + VAPID, through `app/api/push/*` |
| Language | TypeScript (strict); `npx tsc --noEmit` is clean as of 2026-08-01 |

Pages are `'use client'`. **`export const dynamic = 'force-dynamic'` is NOT universal** — it is present in
18 of 29 page files and is absent from the biggest ones (`dispatch`, `order`, `dashboard`, `driver`,
`bins`, `customers`, `drivers`, `login`). Match the file you are editing; don't add it reflexively.

There is no test suite. Verification = `npx tsc --noEmit` + `npm run build` + exercising the route.

---

## Repo layout

```
app/
  dashboard  dispatch  order  driver(+/pretrip)      ← operations
  sale  invoices  expenses  receiving  reports(+/statements,/performance,/tax)
  export  prices  import  inventory                  ← business / accounting
  customers  bins  drivers  dump-sites  users  settings  setup
  api/push/*  api/admin/create-user
components/
  AppShell.tsx      ← the frame every admin page renders inside
  Icon.tsx          ← the only icon source (19 outline glyphs)
  Till.tsx          ← the counter till (Quick Sale)
  SettingsProvider.tsx ← per-client module switches (useModules)
  AppLogo  ThemeToggle  ThemeWatcher
db/
  migrations/       ← the whole schema, in dependency order
  expected-schema.json  README.md
scripts/
  migrate.mjs  doctor.mjs  lib/admin.mjs   ← npm run db:migrate / db:doctor
lib/
  client-config.ts  ← every tenant knob
  settings.ts       ← module definitions and their dependencies
  invoice-print.ts  ← the shared customer-facing print document
  supabase/client.ts  supabase/server.ts  roles.ts  push.ts
hooks/useRole.ts
public/sw.js        ← driver PWA service worker
```

---

## Tenant configuration

All knobs live in `lib/client-config.ts`. **Add new tenant settings there with an inline default —
never read `process.env` inside a component.**

| Env var | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_CLIENT_NAME` | `SimpliiTrash` | Display name |
| `NEXT_PUBLIC_CLIENT_SHORT_NAME` | `ST` | **Ticket prefix**, theme + cache keys |
| `NEXT_PUBLIC_CLIENT_REQUIRE_BIN` | `true` | `'false'` → all bin requirements become optional (BR) |
| `NEXT_PUBLIC_CLIENT_TAX_LABEL` | `HST` | Tax name on every document |
| `NEXT_PUBLIC_CLIENT_TAX_RATE` | `13` | Percent, applied in JS |
| `NEXT_PUBLIC_CLIENT_PRIMARY_COLOR` | `#0f766e` | The single UI accent |
| `NEXT_PUBLIC_CLIENT_SECONDARY_COLOR` | `#0f172a` | Login page only |
| `NEXT_PUBLIC_CLIENT_YARD_ADDRESS` | `''` | Head Back map target; empty hides the button |
| `NEXT_PUBLIC_CLIENT_LOGO_URL` | `null` | Empty → `AppLogo` renders nothing |
| `NEXT_PUBLIC_CLIENT_ICON_PREFIX` | `icon` | PWA icons at `/icons/<prefix>-192.png` / `-512.png` |
| `NEXT_PUBLIC_CLIENT_TAGLINE`, `_ICON_URL`, `_EMAIL_PLACEHOLDER` | — | Cosmetic |
| `NEXT_PUBLIC_SUPABASE_URL`, `_ANON_KEY` | — | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only (`api/admin/create-user`, push routes) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | — | Push; **unset ⇒ no service worker at all** |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | — | Address autocomplete |

⚠ `.env.local.example` is **stale** — it omits `REQUIRE_BIN`, `TAX_LABEL`, `TAX_RATE`, `YARD_ADDRESS`,
`ICON_URL` and `GOOGLE_MAPS_API_KEY`. Use the table above as the source of truth.

⚠ `NEXT_PUBLIC_CLIENT_NAME` is **not set** in `.env.local` — SimpliiTrash is named purely by the
`'SimpliiTrash'` default on line 1 of `lib/client-config.ts`. For a product that default should be
neutral and every client set explicitly, but flipping it requires setting the var on the Vercel
deploy first or production renames itself.

### Two layers of configuration

| Layer | Lives in | Changing it | Examples |
|---|---|---|---|
| **Deployment** | env vars → `CLIENT_CONFIG` | needs a redeploy | Supabase URL/keys, VAPID keys, branding |
| **Client setup** | `app_settings` table → `useModules()` | a toggle on `/setup` | which modules are on |

`CLIENT_CONFIG` is a *synchronous* import used in ~120 places, so DB-backed values must NOT be moved
into it. Read client setup with `useModules()` from `components/SettingsProvider.tsx` instead; it
caches to `localStorage` so the sidebar renders without waiting on the network.

**Module rules** (`lib/settings.ts`):
- A switch controls what is **offered from now on**. It never hides or deletes existing work — an
  order created while Disposal Sites was on must keep loading, printing and billing after it's off.
- Dependencies live in `resolveModules()` and `enabledOrderTypes()` — never re-derive them at a call
  site. Disposal Sites off ⇒ EXCHANGE / REMOVAL / DUMP RETURN unavailable, because all three require
  a dump site.
- Defaults are "everything on", with `binNumbers` inheriting `CLIENT_CONFIG.requireBin`, so an
  un-migrated deployment behaves exactly as it did before this feature existed.

---

## The core architecture: the order is the spine

One customer job = **one `order` row** = one trip = one invoice.

```
Order  (bin service: order_type + bin_size + bin_type)
  └── order_items[]   material (kind:'product') and charges (kind:'charge')
        ├── stock held at save time via adjust_stock RPC + stock_movements
        └── returned to stock when the order is cancelled
  → appears on the dispatch board
  → driver sees the stops AND "Material to load"
  → billed either:
        prepaid = true  → invoice written immediately (kind 'counter', status 'paid')
        otherwise       → monthly account invoice from /reports/statements
```

**The bin service is never an `order_items` row.** It stays as `order.order_type` + `order.bin_size`
and is priced from `price_book` at billing time. Storing it as a line would double-bill.

Multi-step jobs (EXCHANGE / REMOVAL / DUMP RETURN) advance **in place** via `workflow_step`, and the
driver app is the implementation that does this correctly. See "Known defects" — the order page still
contains a contradictory second implementation.

---

## Coding standards

### Data access

- **Job sites**: always `.neq('is_active', false)` — never `.eq('is_active', true)`. Null means active.
- **Price book catalogue**: always `.eq('kind','product').is('customer_id', null)`. Rows with a
  non-null `customer_id` are per-customer rate overrides, not catalogue items.
- **Customer rates** (statements only): `.or('customer_id.is.null,customer_id.eq.<id>')` then merge
  customer over base — customer wins.
- **Dispatch board**: excludes cancelled and completed (`.not('status','in','("cancelled","completed")')`).
- **Driver app**: `.lte('scheduled_date', getTodayKey())` — today *or earlier*, so unfinished work
  survives midnight — plus `.not('status','in','("completed","cancelled")')`.
- **"Busy" driver**: holds an assigned/in_progress order scheduled `<= today`. Never `=== today`.
- **Reports / export**: exclude void invoices with `.neq('status','void')`. Expenses have no status.
- **Bin lookup at a job site**: `location === address && status === 'in_use'`.
- **Material auto-fill**: derive `bin_type` from order history for that bin (`bin_id` or `old_bin_id`),
  not from the bin record alone.

### Money and stock

- **Never write `price_book.stock_qty` directly.** Call the `adjust_stock(p_id, p_delta)` RPC and
  insert a matching `stock_movements` row. Concurrent tills would otherwise clobber each other.
- Only move stock for rows that are `kind === 'product'` **and** `track_stock`.
- Movement kinds: `receive` (Stock In only) · `sale` (negative delta) · `return` (positive delta) ·
  `adjust` (stocktake correction).
- **Tax is computed in JS**: `subtotal * (CLIENT_CONFIG.taxRate / 100)`, and `tax_rate` is stamped onto
  the invoice row. The database never computes tax.
- **Never hardcode `13` or `'HST'`.** Always `CLIENT_CONFIG.taxRate` / `.taxLabel`.
- **Never set `invoice_number` client-side** — the DB sequence owns it; read it back with `.select().single()`.
- Invoice `kind`: `counter` (till + prepaid orders) · `account` (monthly statement run).
- Invoices are **voided, never deleted**.
- A missing price must leave `rate`/`amount` as **`null`, never `0`** — the UI flags it and the total
  excludes it. Silently billing $0 is the failure mode this prevents.
- Stock changes go **after** the invoice is committed; a stock hiccup must never lose the sale.

### Units

Fractional quantities are allowed **only for bulk units**:

```ts
const BULK_UNITS = ['yard','yards','yd','cubic yard','tonne','ton','load','m3','hour']
// step 0.25 for bulk, 1 for everything else (each, bag, box, pallet)
```

Block checkout on a fractional countable line:
`"<description> is sold by the <unit> — use a whole number."`
⚠ This list is duplicated in `Till.tsx`, `order/page.tsx` and (shorter)
`prices/page.tsx`. Adding a unit means editing all four.

### Orders

- Order types — exactly: `DELIVERY` · `EXCHANGE` · `REMOVAL` · `DUMP RETURN` · `MATERIAL DELIVERY`.
- Statuses — exactly: `unassigned` · `assigned` · `in_progress` · `completed` · `issue` · `cancelled`.
- **Ticket numbers**: `generateTicketNumber()` only → `` `${CLIENT_CONFIG.shortName}-${7 digits}` ``
  (e.g. `ST-1234567`, `BR-1234567`). Never hardcode a prefix.
- `EXCHANGE` / `REMOVAL` / `DUMP RETURN` require `dump_site_id` (**not** gated by tenant) and
  `old_bin_id` (**gated by `CLIENT_CONFIG.requireBin`**).
- `DUMP RETURN` writes the same bin id to both `bin_id` and `old_bin_id`.
- A bin already on an active order is rejected:
  `"This bin is still linked to active order <ticket>. Finish that order first."`
- Completed orders are locked (read-only modal); only owner/manager may delete them.
- Save order lines **only** through `syncOrderLines()` — it deletes and re-inserts `order_items`, then
  moves stock **by the before/after difference**. Editing 8 yards to 10 must take 2 more, not re-hold 10.
- Any cancel path must call `releaseOrderStock(order)` before touching bins.
- **Delivery charge**: offered only on a `MATERIAL DELIVERY` that already has material. On a bin order
  it is suppressed and replaced with *"No delivery charge — the bin service covers this trip."*
  The charge row is found **by shape** — `kind:'service'`, no `service_type`, name contains "delivery".

### Driver status machine

Seven values: `available` · `busy` (auto-managed) — `heading_back` · `parked` · `stopped` ·
`emergency` (**sticky**) — `offline`.

**The central rule: automatic writers may only ever set `available` or `busy`, and must guard the
write** so a dispatcher's click can never be clobbered by an in-flight refresh:

```ts
.update({ status: hasActiveOrdersToday ? 'busy' : 'available' })
.eq('id', driverId)
.in('status', ['available', 'busy'])        // ← compare-and-swap
```

Plus a belt-and-braces early return on any sticky status before that write. `reconcileDriverStatuses`
re-asserts the exact status its snapshot saw (`.eq('status', driver.status)`).

Clearing rules: `parked` and `offline` clear on next **login**; `stopped` and `emergency` clear only
via **dispatch RESUME**. The driver app can never self-release from any of the four.
Logging out sets `offline`, and the board filters offline drivers out — a logged-out driver must
never show as Available.

### UI

- Every admin page renders inside `<AppShell title subtitle actions maxWidth>`. Never re-render a
  header, sidebar or `<h1>` yourself. Register new pages in `NAV` under Operations / Business / Setup.
- **All iconography goes through `<Icon name=… />`** (19 names). No emoji as icons on admin pages.
  Colour comes from `text-*`, size from `className`.
- Cards: `rounded-xl` or `rounded-2xl` with **`ring-1 ring-slate-200`** (not `border`).
  *(`rounded-3xl` was the pre-shell style — 49 remaining uses, mostly in older report pages.)*
- Primary button: `rounded-lg px-3 py-2 text-sm font-semibold text-white hover:opacity-90` +
  `style={{ background: 'var(--accent)' }}`.
- Secondary: `text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50` + an `<Icon>`.
- **Accent tokens**: `--accent` ← `--brand-primary` (set inline on `<body>`), with
  `--accent-soft` / `--accent-ring` derived via `color-mix`. Dark bars use `--ink` (#14181a).
- **Do not write `dark:` variants** for ordinary surfaces/text/borders — `globals.css` already
  overrides the plain utility classes under `.dark`.
- **Time fields**: always a `<select>` dropdown (5 AM–8 PM, 30-min slots), never `<input type="time">`.
- **Date-only columns**: parse as `new Date(d + 'T12:00:00')`, format `'en-CA'`. Plain `new Date(d)`
  parses as UTC midnight and shifts a day in Toronto.
- Driver app inputs set `style={{ fontSize: '16px' }}` inline to stop iOS zoom.
- Customer-facing print goes through `printInvoiceDocument` (`lib/invoice-print.ts`): absolute logo
  URL, accent inlined as a JS string (CSS vars don't exist in the print window), every value escaped.

### Access control

Every business/report page self-gates in a `useEffect`:

```ts
if (!roleLoading && role !== null && !can(role, 'canViewReports')) {
  router.push(role === 'driver' ? '/driver' : '/dispatch')
}
```

⚠ The sidebar is **not** role-filtered and RLS is `to authenticated using (true)` on every table —
the gate is cosmetic. Any signed-in user can read all data. Treat this as a known limitation.

⚠ Weaker still: **most admin pages render for a signed-out visitor.** Verified 2026-08-01 with no
session in storage at all — `/order`, `/reports` and `/reports/tax` drew the full shell (sidebar,
"Log out", headers) and merely showed empty data, because the anon key can't satisfy the
`to authenticated` policies. Only `app/reports/statements/page.tsx` actually checks
(`supabase.auth.getUser()` → `router.push('/login')`); every other page relies on the role gate,
which no-ops when `role` is null. No data leaks, but the app looks logged in when it isn't.

### Service worker

`public/sw.js` — network-first for navigations, cache-first for other same-origin GETs, and it must
**never intercept `/_next/`** (content-hashed assets; a stale copy breaks the deploy). Bump
`CACHE_NAME` whenever the cached shell changes; `activate` deletes every other cache.

---

## Database schema

| Table | Important columns |
|---|---|
| `order` | `ticket_number`, `order_type`, `status`, `bin_id`, `old_bin_id`, `bin_number` (text), `bin_size` (text), `bin_type`, `workflow_step`, `dump_site_id`, `dump_site_address`, `scheduled_date`, `service_time`, `route_position`, `parent_order_id`, `delivery_photo_url`, **`invoice_id`**, **`prepaid`** |
| `order_items` | `order_id`, `price_book_id`, `kind` (`product`\|`charge`), `description`, `unit`, `quantity`, `rate`, `amount` |
| `price_book` | `kind` (`service`\|`product`), `service_type`, `bin_size`, `name`, `unit`, `price`, `customer_id`, `track_stock`, `stock_qty`, `low_stock_at` |
| `invoices` | `invoice_number` (DB sequence), `kind` (`counter`\|`account`), `customer_id`, `subtotal`, `tax_rate`, `tax_amount`, `total`, `status` (`draft`\|`sent`\|`paid`\|`void`), `payment_method` |
| `invoice_items` | `invoice_id`, `description`, `unit`, `quantity`, `rate`, `amount` — **no `kind` column** |
| `stock_movements` | `price_book_id`, `movement_date`, `kind` (`receive`\|`sale`\|`adjust`\|`return`), `quantity`, `note`, `invoice_id`, `order_id`, `expense_id` |
| `expenses` | `expense_date`, `supplier`, `category`, `subtotal`, `tax_amount`, `total`, `payment_method`, `reference` |
| `bins` | `bin_number`, `bin_size`, `bin_type`, `status` (`in_use`\|`available`), `location` |
| `dump_sites` | `id`, `name`, `address`, `notes` |
| `job_sites` | `customer_id`, `site_name`, `address`, `unit`, `city`, `province`, `postal_code`, `is_active` |
| `drivers` | `status`, `auth_user_id` |
| `user_profiles` | **`user_id`**, `role` |

⚠ `user_profiles` is keyed by **`user_id`**, not `auth_user_id`, and has **no `full_name`** column
(verified against the live BR project 2026-08-01 with a control test). `drivers.auth_user_id` does exist.

`workflow_step` takes **three** values in live code: `MAIN` (new orders), `DUMP` and `RETURN`.
`PICKUP` is historical — only the deleted `NewOrderModal` ever wrote it — but existing rows may
still carry it, and the driver app treats `MAIN`, `PICKUP` and null identically, so don't "clean it up".

---

## Current state of development

### Working end to end
Order CRUD + bin lifecycle · dispatch kanban with drag-to-reorder, 15s poll and self-healing driver
status · driver PWA (offline queue, photo capture, multi-step workflow, sticky statuses) · the
dispatch→order iframe create flow · order material lines with diff-based stock reconciliation ·
prepaid self-invoicing · Quick Sale till · Price Book · invoice register (filter/print/mark-paid/void) ·
Stock In (one action writes the supplier bill *and* raises stock) · Inventory with stocktake correction ·
Expenses CRUD · HST return (CRA lines 101/105/108/109) · QuickBooks CSV + IIF export · CSV import ·
Invoice Report with the three-tier delivery lookup · AppShell + tenant theming · PWA manifest.

### Partial
- **Account invoicing** — creates the invoice but never stamps `order.invoice_id`, so nothing marks a
  period as billed.
- **Customer-specific pricing** — consumed by the statement run; **no UI creates it**.
- **Mark Paid / Void** — patch `status` only; no payment date, no un-void, no manual invoice creation.
- **Head Back map** — hidden unless `NEXT_PUBLIC_CLIENT_YARD_ADDRESS` is set.
- **Service worker** — registers only as a side effect of push setup, so no VAPID key ⇒ no offline support.
- **Emoji→Icon migration** — admin pages are clean; the driver PWA still uses ~23 emoji.

### Stubbed / dead
`app/driver/pretrip/page.tsx` — half-built, not legacy: it writes nothing
(`// TODO: Replace with your Supabase insert`) and redirects to `/driver-route`, which does not
exist, but a `pre_trip_inspections` table exists so it was intended. Nothing links to it. ·
`Till mode="services"` · the Dashboard "Customer Report" modal · oversell prevention (none — stock goes negative).

**Deleted 2026-10-01** (superseded, zero importers, and they queried `jobs` / `loads` / `profiles`
which no migration creates — so they broke every new client): `app/loads/`, `app/admin/`,
`components/dashboard-shell.tsx`, `components/Navbar.tsx`, `components/NewOrderModal.tsx`.
The `loads` table does not exist even on SimpliiTrash, so `/loads` had been failing for some time.
`lucide-react` stays — `app/reset-password/page.tsx` still uses it.

---

## Known defects

Found in a codebase audit on **2026-08-01**. The first four were confirmed by direct inspection;
the rest come from the audit pass and are worth re-checking before acting on them.

**P1 — user-visible, confirmed**

1. ~~**`MATERIAL DELIVERY` cannot be saved.**~~ **Fixed 2026-08-01.** `applyWorkflowAndBuildPayload`
   (`app/order/page.tsx`) now has a `MATERIAL DELIVERY` branch returning no bin ids, `bin_size` /
   `bin_type` are written `null` for that type (the form hides both selects), and the save is gated on
   at least one material line: *"A material delivery needs at least one material line."*
   The driver stop bar no longer renders a `— yd` chip when `bin_size` is null.
2. ~~**`components/NewOrderModal.tsx` is dead code.**~~ **Deleted 2026-10-01**, along with
   `/loads`, `/admin`, `dashboard-shell` and `Navbar`. `app/order/page.tsx` is now the only create
   form; dispatch opens it at `/order?newOrder=1&embedded=1` and talks to it via `postMessage`.
   The `/parity` skill was removed with it and `/check` was rewritten.
3. ~~**The create modal leaks material between orders.**~~ **Fixed 2026-08-01.** One `resetLineState()`
   clears `orderLines` / `originalLines` / `lineSearch` / `prepaid`, and `openCreateModal`,
   `openEditModal` and `closeModal` all call it. `openCreateModal` also resets `newAddrDetails`, which
   leaked the same way. Any new modal-opening path must call it too.
4. **Two contradictory two-step implementations coexist.** `createLinkedWorkflowOrders`
   (`app/order/page.tsx`) *inserts child orders*; the driver app advances `workflow_step` on the same
   row. Which one runs depends on who closes the job. The single-order model is the intended one.

**P1 — billing integrity**

5. ~~**Double-billing.**~~ **Fixed 2026-08-01.** `loadAccountBilling` (`lib/billing.ts`) filters both
   order passes on `.is('invoice_id', null)` and `.eq('prepaid', false)`, so a prepaid order that
   already settled itself can never be re-billed.
6. ~~**Re-running a statement creates a duplicate invoice.**~~ **Fixed 2026-08-01.** Issuing an account
   invoice stamps `order.invoice_id` on every order it covers, and a stamp failure is reported loudly
   with instructions to void — silence there would resurrect the bug.
7. ~~**Draft invoices count as tax collected.**~~ **Fixed 2026-08-01.** `/reports/tax` and `/export`
   now filter `.not('status','in','("void","draft")')`. A draft is unissued, so no tax is owed on it.
8. **`releaseOrderStock` ignores `track_stock`**, inflating stock for untracked products on cancel; and
   its double-credit guard misfires after any downward quantity edit, so held stock is never returned.
9. **`createPrepaidInvoice` fails silently** — on error the order is saved `prepaid = true` with no
   invoice and no message.

**P2**

10. Dispatch `todayKey` is memoized with an empty dep array — a board left open across midnight keeps
    yesterday's key until reload.
11. `.neq('status','offline')` silently drops drivers with a NULL status (Postgres NULL comparison).
12. `app/drivers/page.tsx` bypasses the sticky-status contract with an unguarded status write.
13. Dashboard `isToday` is off by one in negative-UTC offsets (missing the `T12:00:00` anchor).
14. Stock In can double-post a supplier bill if `adjust_stock` fails mid-save.
15. Unbounded customer-history fetch in statements hits PostgREST's 1000-row cap silently.
16. The IIF export only balances if `invoice_items` sum exactly to `invoices.subtotal`.
17. `ThemeWatcher` clobbers the stored light/dark preference with the OS setting on every mount.
18. `postMessage` between the dispatch iframe and parent uses `'*'` with no origin check.
19. ~~**Saving an order before its lines finish loading wipes them.**~~ **Fixed 2026-08-01.**
    `openEditModal` sets `linesLoading` before firing `loadOrderLines` (which clears it in a
    `finally`); Save is disabled and reads *"Loading material…"* until the lines are in, with a
    guard in `handleCreateOrUpdate` as well. Without it `syncOrderLines` deleted every `order_items`
    row and re-inserted an empty set, returning no stock because `originalLines` was empty too.
    `releaseOrderStock` was never at risk — it re-reads the lines from the database.
20. ~~The order page never blocks a fractional quantity on a countable unit.~~ **Fixed 2026-08-01.**
    `handleCreateOrUpdate` now runs the same check as `Till.tsx`
    (`"<description> is sold by the <unit> — use a whole number."`), and a fractional countable line
    shows *"Sold by the &lt;unit&gt; — whole numbers only."* inline, matching the till.
21. ~~**Material was billed at $0 when its rate was null.**~~ **Fixed 2026-08-01.** The account run did
    `rate: Number(it.rate)`, and `Number(null)` is `0` — so an order line the order page deliberately
    left unpriced was billed free, silently, while the service lines went out of their way to flag the
    same case. Material now keeps `null` and is flagged and excluded like everything else.
22. ~~**BR Garden Center could not be invoiced at all.**~~ **Fixed 2026-08-01.** `BILLING_TYPES` covers
    only REMOVAL/EXCHANGE/DUMP RETURN, so a material-only tenant produced zero billing events — and the
    old Invoice Report gated its entire action bar, Create Invoice included, on
    `sortedCycles.length > 0`. Money sat in the material lines with no way to bill it. The builder now
    gates on "is there anything priced at all", so material alone is invoiceable.
    `BILLING_TYPES` itself is unchanged — a MATERIAL DELIVERY has no bin service to price.
23. **Still open: the statement print path does not use `lib/invoice-print.ts`.**
    `printStatement`/`printLayout` in `app/reports/statements/page.tsx` interpolate customer name,
    address and driver notes into HTML **with no escaping**. That page is now activity-only (no money),
    but the injection is real. Route it through `printInvoiceDocument`, which escapes.

---

## Skills

`/check` · `/db-check` · `/driver-check` · `/sql` · `/br-sync`

`/parity` was deleted with `NewOrderModal` (it compared the two create forms; there is only one
now), and `/check` was rewritten — its form-parity and `workflow_step: 'PICKUP'` assertions were
both stale. It now checks the single-create-form contract, module gating, and schema parity via
`npm run db:doctor`.

---

## Tenant Setup SQL

**All applied and verified on both current projects (SimpliiTrash + BR Garden Center).**
`order_items`, `order.invoice_id`, `order.prepaid` and `stock_movements.order_id` were verified present
on BR on 2026-08-01. Keep everything below for onboarding any NEW tenant.

⚠ RLS note: every NEW table starts publicly exposed. Enable RLS + create the four `to authenticated`
policies (select/insert/update/delete), same pattern as `dump_sites` below. Old projects may carry
permissive "allow everyone" template policies that override new ones — drop all policies first (loop
over `pg_policies`) when locking down an existing table.

```sql
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS bin_number text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS workflow_step text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS parent_order_id uuid;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS dump_site_address text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS delivery_photo_url text;
ALTER TABLE dump_sites ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE job_sites ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE job_sites ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE job_sites ADD COLUMN IF NOT EXISTS province text DEFAULT 'ON';
ALTER TABLE job_sites ADD COLUMN IF NOT EXISTS postal_code text;
UPDATE customers SET status = 'active' WHERE status IS NULL;
```

`price_book` table (added 2026-07-22, stage 1 of invoicing — run in both projects):

```sql
create table if not exists price_book (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('service','product')),
  service_type text,
  bin_size text,
  name text,
  unit text,
  price numeric(10,2) not null default 0,
  customer_id uuid references customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table price_book enable row level security;
drop policy if exists "price_book_select" on price_book;
drop policy if exists "price_book_insert" on price_book;
drop policy if exists "price_book_update" on price_book;
drop policy if exists "price_book_delete" on price_book;
create policy "price_book_select" on price_book for select to authenticated using (true);
create policy "price_book_insert" on price_book for insert to authenticated with check (true);
create policy "price_book_update" on price_book for update to authenticated using (true) with check (true);
create policy "price_book_delete" on price_book for delete to authenticated using (true);
```

`invoices` + `invoice_items` (added 2026-07-22, stage 3 of invoicing — run in both projects). Invoice numbers come from a DB sequence so concurrent tills can't collide:

```sql
create sequence if not exists invoice_number_seq start 1;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique
    default ('INV-' || lpad(nextval('invoice_number_seq')::text, 5, '0')),
  kind text not null default 'counter' check (kind in ('counter','account')),
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  issue_date date not null default current_date,
  subtotal numeric(10,2) not null default 0,
  tax_rate numeric(5,2) not null default 13,
  tax_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  status text not null default 'paid' check (status in ('draft','sent','paid','void')),
  payment_method text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  unit text,
  quantity numeric(10,2) not null default 1,
  rate numeric(10,2) not null default 0,
  amount numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

alter table invoices enable row level security;
alter table invoice_items enable row level security;
drop policy if exists "invoices_select" on invoices;
drop policy if exists "invoices_insert" on invoices;
drop policy if exists "invoices_update" on invoices;
drop policy if exists "invoices_delete" on invoices;
create policy "invoices_select" on invoices for select to authenticated using (true);
create policy "invoices_insert" on invoices for insert to authenticated with check (true);
create policy "invoices_update" on invoices for update to authenticated using (true) with check (true);
create policy "invoices_delete" on invoices for delete to authenticated using (true);
drop policy if exists "invoice_items_select" on invoice_items;
drop policy if exists "invoice_items_insert" on invoice_items;
drop policy if exists "invoice_items_update" on invoice_items;
drop policy if exists "invoice_items_delete" on invoice_items;
create policy "invoice_items_select" on invoice_items for select to authenticated using (true);
create policy "invoice_items_insert" on invoice_items for insert to authenticated with check (true);
create policy "invoice_items_update" on invoice_items for update to authenticated using (true) with check (true);
create policy "invoice_items_delete" on invoice_items for delete to authenticated using (true);
```

`order_items` (added 2026-07-30 — orders carry material and charges alongside the bin service, so one order covers a whole trip). The bin service itself is NOT a line: it stays as `order.order_type` + `bin_size` and is priced from the price book at billing time.

```sql
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references "order"(id) on delete cascade,
  price_book_id uuid references price_book(id) on delete set null,
  kind text not null default 'product' check (kind in ('product','charge')),
  description text not null,
  unit text,
  quantity numeric(10,2) not null default 1,
  rate numeric(10,2) not null default 0,
  amount numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_id_idx on order_items(order_id);

alter table order_items enable row level security;
drop policy if exists "order_items_select" on order_items;
drop policy if exists "order_items_insert" on order_items;
drop policy if exists "order_items_update" on order_items;
drop policy if exists "order_items_delete" on order_items;
create policy "order_items_select" on order_items for select to authenticated using (true);
create policy "order_items_insert" on order_items for insert to authenticated with check (true);
create policy "order_items_update" on order_items for update to authenticated using (true) with check (true);
create policy "order_items_delete" on order_items for delete to authenticated using (true);

-- Which invoice settled this order, and whether it was paid when placed
alter table "order" add column if not exists invoice_id uuid references invoices(id) on delete set null;
alter table "order" add column if not exists prepaid boolean not null default false;

-- ⚠ PENDING 2026-08-01 — run in BOTH projects. When the money actually arrived,
-- as opposed to when the invoice was raised. The code tolerates its absence
-- (app/invoices/page.tsx falls back to a select and an update without it), so
-- deploy order does not matter — but no payment date is recorded until it runs.
alter table invoices add column if not exists paid_at date;

-- Stock movements can be caused by an order, not just a counter invoice
alter table stock_movements add column if not exists order_id uuid references "order"(id) on delete set null;
```

`app_settings` (added 2026-10-01 — **System Setup**, the per-client module switches behind
`/setup`). This is what turns two bespoke builds into one product: a client's shape lives in their
own database and changes without a redeploy. The app falls back to `DEFAULT_MODULES` when the table
or row is absent, so it can be run at any time, before or after deploying.

```sql
-- One row only; the boolean primary key with check(id) enforces it.
create table if not exists app_settings (
  id boolean primary key default true check (id),
  modules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table app_settings enable row level security;
drop policy if exists "app_settings_select" on app_settings;
drop policy if exists "app_settings_insert" on app_settings;
drop policy if exists "app_settings_update" on app_settings;
drop policy if exists "app_settings_delete" on app_settings;

-- Everyone signed in must read it: the sidebar is built from it.
create policy "app_settings_select" on app_settings
  for select to authenticated using (true);

-- Only owner/manager may reshape the app. Note this is the first table in the
-- project whose policy is role-aware rather than `using (true)`.
create policy "app_settings_insert" on app_settings
  for insert to authenticated with check (
    exists (select 1 from user_profiles up
            where up.user_id = auth.uid() and up.role in ('owner','manager'))
  );

create policy "app_settings_update" on app_settings
  for update to authenticated using (
    exists (select 1 from user_profiles up
            where up.user_id = auth.uid() and up.role in ('owner','manager'))
  ) with check (
    exists (select 1 from user_profiles up
            where up.user_id = auth.uid() and up.role in ('owner','manager'))
  );

-- Deliberately no delete policy: the setup row is never removed.
```

Retail inventory (added 2026-07-29 — stock lives on `price_book` products; `adjust_stock` is a function so concurrent tills can't clobber each other's read-modify-write):

```sql
alter table price_book add column if not exists track_stock boolean not null default false;
alter table price_book add column if not exists stock_qty numeric(10,2) not null default 0;
alter table price_book add column if not exists low_stock_at numeric(10,2);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  price_book_id uuid not null references price_book(id) on delete cascade,
  movement_date date not null default current_date,
  kind text not null check (kind in ('receive','sale','adjust','return')),
  quantity numeric(10,2) not null,
  note text,
  invoice_id uuid references invoices(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table stock_movements enable row level security;
drop policy if exists "stock_movements_select" on stock_movements;
drop policy if exists "stock_movements_insert" on stock_movements;
drop policy if exists "stock_movements_update" on stock_movements;
drop policy if exists "stock_movements_delete" on stock_movements;
create policy "stock_movements_select" on stock_movements for select to authenticated using (true);
create policy "stock_movements_insert" on stock_movements for insert to authenticated with check (true);
create policy "stock_movements_update" on stock_movements for update to authenticated using (true) with check (true);
create policy "stock_movements_delete" on stock_movements for delete to authenticated using (true);

-- Receiving a delivery links the supplier bill to the stock it brought in
alter table expenses add column if not exists reference text;
alter table stock_movements add column if not exists expense_id uuid references expenses(id) on delete set null;

-- Atomic increment/decrement; returns the new quantity
create or replace function adjust_stock(p_id uuid, p_delta numeric)
returns numeric
language sql
security invoker
as $$
  update price_book
     set stock_qty = stock_qty + p_delta,
         updated_at = now()
   where id = p_id
  returning stock_qty;
$$;
grant execute on function adjust_stock(uuid, numeric) to authenticated;
```

`expenses` table (added 2026-07-28, stage 5 of invoicing — supplier bills feed the HST return's input tax credits):

```sql
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  supplier text,
  category text,
  description text,
  subtotal numeric(10,2) not null default 0,
  tax_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  payment_method text,
  receipt_url text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table expenses enable row level security;
drop policy if exists "expenses_select" on expenses;
drop policy if exists "expenses_insert" on expenses;
drop policy if exists "expenses_update" on expenses;
drop policy if exists "expenses_delete" on expenses;
create policy "expenses_select" on expenses for select to authenticated using (true);
create policy "expenses_insert" on expenses for insert to authenticated with check (true);
create policy "expenses_update" on expenses for update to authenticated using (true) with check (true);
create policy "expenses_delete" on expenses for delete to authenticated using (true);
```

RLS policies for `dump_sites` (INSERT was blocked, found 2026-07-07 — run in both projects):

```sql
alter table dump_sites enable row level security;
drop policy if exists "dump_sites_select" on dump_sites;
drop policy if exists "dump_sites_insert" on dump_sites;
drop policy if exists "dump_sites_update" on dump_sites;
drop policy if exists "dump_sites_delete" on dump_sites;
create policy "dump_sites_select" on dump_sites for select to authenticated using (true);
create policy "dump_sites_insert" on dump_sites for insert to authenticated with check (true);
create policy "dump_sites_update" on dump_sites for update to authenticated using (true) with check (true);
create policy "dump_sites_delete" on dump_sites for delete to authenticated using (true);
```

Storage bucket `delivery-photos` (both projects — bucket must be PUBLIC for getPublicUrl display; upload uses upsert so UPDATE policy is required too):

```sql
insert into storage.buckets (id, name, public)
values ('delivery-photos', 'delivery-photos', true)
on conflict (id) do update set public = true;
drop policy if exists "delivery_photos_insert" on storage.objects;
drop policy if exists "delivery_photos_update" on storage.objects;
drop policy if exists "delivery_photos_select" on storage.objects;
create policy "delivery_photos_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'delivery-photos');
create policy "delivery_photos_update" on storage.objects
  for update to authenticated using (bucket_id = 'delivery-photos') with check (bucket_id = 'delivery-photos');
create policy "delivery_photos_select" on storage.objects
  for select to authenticated using (bucket_id = 'delivery-photos');
```

BR Garden Center: Rodrigo driver needs Supabase Auth account created and `auth_user_id` linked in `drivers` table.
