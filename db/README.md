# Onboarding a new client

One codebase, one Supabase project per client, one deployment per client.
Everything a client's database needs is in `migrations/`, applied in filename order.

## Before this existed

The base tables (`order`, `customers`, `bins`, `drivers`, `job_sites`, `dump_sites`,
`user_profiles`, `trucks`, `driver_push_subscriptions`) were created by hand in the
dashboard and no migration covered them — so the runbook in `CLAUDE.md` could not
actually build a new client. It also listed the blocks in an order that fails:
`order_items` references `stock_movements`, and `stock_movements` references
`expenses`, both of which came later in the document.

`001_base_tables.sql` fills the gap and the numbering fixes the order.

## The steps

### 1. Create the Supabase project

New project in the client's own organisation. Record the project URL
(`https://<ref>.supabase.co`), the **publishable** key and the **service role** key
from Project Settings → API.

### 2. Run the migrations

With a personal access token (one token covers all your projects — get it from
supabase.com/dashboard/account/tokens):

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
node scripts/migrate.mjs --url https://<ref>.supabase.co
```

Without a token, print the SQL and paste it into the project's SQL editor:

```bash
node scripts/migrate.mjs --url https://<ref>.supabase.co --print > onboarding.sql
```

Every migration is idempotent and the project records what it has run in its own
`schema_migrations` table, so re-running is safe.

### 3. Verify

```bash
node scripts/doctor.mjs --url https://<ref>.supabase.co --key <service role key>
```

This compares the live schema against `expected-schema.json`, captured from a
known-good project. **Do not skip it.** A missing column is the difference between
a client working and a client silently losing data, and the failure mode is quiet.

### 4. Deploy the site

New Vercel project from this repository, with the client's own domain and these
environment variables (the full list lives in `CLAUDE.md`):

| | |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
| `NEXT_PUBLIC_CLIENT_NAME` / `_SHORT_NAME` | **set both explicitly** — the short name is the ticket prefix |
| `NEXT_PUBLIC_CLIENT_PRIMARY_COLOR`, `_LOGO_URL`, `_ICON_PREFIX` | branding |
| `NEXT_PUBLIC_CLIENT_TAX_LABEL` / `_TAX_RATE` | tax, per province |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push; without these the driver app gets no service worker and no offline support |

### 5. Create the first user

Create the owner in Supabase Auth, then insert their profile:

```sql
insert into user_profiles (user_id, role, name, email)
values ('<auth user id>', 'owner', 'Owner Name', 'owner@client.com');
```

The column is `user_id`, not `auth_user_id`. Only `owner` and `manager` can reach
System Setup.

### 6. Hand over System Setup

Sign in as the owner and open **Settings → System Setup**. Switch off whatever this
client doesn't do. Nothing else about onboarding is client-specific — the tailoring
happens here, not in code.

## Adding a migration

Create `db/migrations/0NN_what_it_does.sql`, newest number last. Rules:

- **Idempotent.** `create table if not exists`, `add column if not exists`,
  `drop policy if exists` before `create policy`.
- **Self-contained.** It must run against a project that is several versions behind.
- **Enable RLS on every new table.** A new table in Supabase starts publicly
  readable. Older projects may also carry permissive "allow everyone" template
  policies that override new ones — drop all policies for the table first, the way
  `001_base_tables.sql` does.

Then apply it to every client and re-run the doctor on each.

## Known wrinkles

- **`order.bin_size` is `integer`, `price_book.bin_size` is `text`.** The app
  stringifies before comparing, so the price lookup works, but strict `===`
  comparisons on raw values do not. Worth unifying one day; changing it means
  migrating live data, so it is deliberately left alone here.
- **`001_base_tables.sql` reconstructs defaults and check constraints**, because
  PostgREST's schema does not expose them. Columns, types, primary keys and foreign
  keys are accurate. The doctor verifies structure, not defaults.
- **`order.created_at` differs between old and new clients.** The reference project
  has `timestamp without time zone`; `001` creates `timestamptz`, which is the right
  type. Existing projects are left alone rather than migrated. `doctor.mjs` reports
  this as a non-fatal type difference so it stays visible instead of hiding.
- **`/loads` and `/admin` query legacy tables** (`jobs`, `loads`, `profiles`) that
  `001` deliberately does not create. Both routes are already marked legacy in
  `CLAUDE.md` alongside `components/dashboard-shell.tsx`; on a newly provisioned
  client they will error. Delete them, or gate them, before onboarding anyone.
- **The SQL endpoint is experimental.** Supabase marks
  `POST /v1/projects/{ref}/database/query` as beta and subject to change. It is used
  in exactly one place — `runSql()` in `scripts/lib/admin.mjs`. If it disappears,
  `--print` still works.
