# Project Health Check

Run a full automated health check and fix any straightforward issues found.

## Steps

### 1. TypeScript
Run `npx tsc --noEmit` and report all errors with file:line. Fix any that are simple (missing type, wrong import). For complex ones, describe what needs to be done.

### 2. Dead symbol references
Grep for symbols that were removed in past sessions — any hit means a broken reference:
- `quickForm` in any `.tsx`/`.ts` (removed — the order page is the only create form)
- `quickSaving` / `quickError` / `emptyQuickForm` / `QUICK_TIME_OPTIONS` (same)
- `handleQuickCreate` / `handleQuickCustomerChange` (same)
- `setQuickForm` (same)
- `NewOrderModal`, `dashboard-shell`, `Navbar` (deleted — dead code)

### 3. Time input violations
Run: `grep -rn 'type="time"' app/ components/`
There must be zero results. Every time field uses a `<select>` dropdown (5 AM–8 PM, 30-min slots). Fix any violations found.

### 4. Job sites query flag
Run: `grep -rn "is_active.*true\|eq.*is_active" app/ components/`
Any `.eq('is_active', true)` must be changed to `.neq('is_active', false)`. Fix automatically.

### 5. Cancelled/completed orders on dispatch board
Check `app/dispatch/page.tsx` loads orders with `.not('status', 'in', '("cancelled","completed")')`. If missing, add it.

### 6. One create form
`app/order/page.tsx` is the only create form. Dispatch opens it in an iframe at
`/order?newOrder=1&embedded=1` and talks to it with `postMessage` ('order-created',
'order-modal-close'). Verify both sides of that contract still exist, and that no
second create form has appeared anywhere.

### 7. Multi-step order workflow_step
New orders are written `workflow_step: 'MAIN'`. The driver app advances the SAME row
to 'DUMP' and then 'RETURN' — it never inserts a second order. Check that
`app/order/page.tsx` has not regained a path that inserts child orders for a two-step
job. ('PICKUP' is historical and no longer written by any live code.)

### 8. Module gating
Checks that the client's System Setup switches still drive the UI: the sidebar in
`components/AppShell.tsx` filters on `isRouteEnabled`, and the order form builds its
type dropdown from `enabledOrderTypes()`. Both read `useModules()`.

### 9. Schema parity
Run `npm run db:doctor` against the project in `.env.local`. Report anything missing.

## Output format
Report each check as ✅ pass or ❌ fail with details.
Auto-fix what you can. For anything requiring the user's action (e.g. SQL), list it clearly at the end.
