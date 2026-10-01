#!/usr/bin/env node
/**
 * Apply pending migrations to one client's project.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/migrate.mjs --url https://<ref>.supabase.co
 *   node scripts/migrate.mjs --url https://<ref>.supabase.co --dry-run
 *   node scripts/migrate.mjs --url https://<ref>.supabase.co --print > onboarding.sql
 *
 * --print writes the SQL to stdout for pasting into the dashboard and never
 * touches the project, so it works with no token at all.
 *
 * Which migrations a project has had is recorded in its own schema_migrations
 * table, so this is safe to re-run and safe against an up-to-date project.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AdminError, colour, parseArgs, refFromUrl, requireValue, runSql } from './lib/admin.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, '..', 'db', 'migrations')

// RLS with no policies: the Management API and service_role bypass RLS, so the
// tooling keeps working, while anon and authenticated get nothing. Without this
// the ledger is writable by anyone holding the publishable key, and inserting a
// version string would make that migration be skipped forever.
const LEDGER = `
create table if not exists schema_migrations (
  version text primary key,
  checksum text,
  applied_at timestamptz not null default now()
);
alter table schema_migrations add column if not exists checksum text;
alter table schema_migrations enable row level security;`

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16)

async function loadMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort()
  const out = []
  for (const name of files) {
    if (!/^[0-9A-Za-z_.-]+$/.test(name)) {
      throw new AdminError(`Migration filename has unsafe characters: ${name}`)
    }
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
    const bare = sql.replace(/--[^\n]*/g, '').trim()
    if (!bare) throw new AdminError(`Migration ${name} contains no SQL — refusing to record it as applied.`)
    out.push({ version: name.replace(/\.sql$/, ''), name, sql, checksum: sha(sql) })
  }
  return out
}

/** Dollar-quoting avoids any escaping question in the version string. */
const stamp = m =>
  `insert into schema_migrations (version, checksum) values ($mig$${m.version}$mig$, $mig$${m.checksum}$mig$)
     on conflict (version) do update set checksum = excluded.checksum;`

async function readLedger({ ref, token, create }) {
  if (create) await runSql({ ref, token, sql: LEDGER })
  let rows
  try {
    rows = await runSql({ ref, token, sql: 'select version, checksum from schema_migrations;' })
  } catch (err) {
    // A project that has never been migrated has no ledger yet.
    if (/schema_migrations/i.test(err.message) && /does not exist|undefined_table/i.test(err.message)) {
      return new Map()
    }
    throw err
  }
  if (!Array.isArray(rows) || rows.some(r => typeof r !== 'object' || r === null || !('version' in r))) {
    // Coercing this to "nothing applied" would re-run every migration.
    throw new AdminError(
      `Unexpected response reading schema_migrations — refusing to guess what is applied.\n${JSON.stringify(rows).slice(0, 400)}`
    )
  }
  return new Map(rows.map(r => [r.version, r.checksum]))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || (!args.url && !process.env.SUPABASE_URL)) {
    console.error(`Usage:
  SUPABASE_ACCESS_TOKEN=sbp_... node scripts/migrate.mjs --url https://<ref>.supabase.co
  node scripts/migrate.mjs --url https://<ref>.supabase.co --dry-run
  node scripts/migrate.mjs --url https://<ref>.supabase.co --print > onboarding.sql

Reads SUPABASE_URL and SUPABASE_ACCESS_TOKEN from the environment.`)
    process.exit(2)
  }

  const url = requireValue(args, 'url', process.env.SUPABASE_URL, { what: 'the project URL' })
  const token = args.token || process.env.SUPABASE_ACCESS_TOKEN
  const ref = refFromUrl(url)
  const migrations = await loadMigrations()

  // --print never contacts the project, so it cannot know what is applied. It
  // emits everything, which is safe because every migration is idempotent.
  if (args.print) {
    const body = migrations
      .map(m => `-- ${'='.repeat(70)}\n-- ${m.name}\n-- ${'='.repeat(70)}\n${m.sql}`)
      .join('\n')
    const stamps = migrations.map(stamp).join('\n')
    process.stdout.write(`${LEDGER}\n\n${body}\n\n-- record what ran\n${stamps}\n`)
    return
  }

  console.log(colour.bold(`\nProject ${ref}`) + colour.dim(`  (${args.url ? '--url' : 'SUPABASE_URL'})`))

  // A dry run must not write. Creating the ledger is DDL, so it is skipped here
  // and a missing ledger is simply read as "nothing applied".
  const applied = await readLedger({ ref, token, create: !args['dry-run'] })
  const pending = migrations.filter(m => !applied.has(m.version))
  const changed = migrations.filter(m => applied.has(m.version) && applied.get(m.version) && applied.get(m.version) !== m.checksum)

  for (const m of changed) {
    console.log(colour.warn(`  ! ${m.name} was edited since it was applied here — the project will NOT be updated.`))
  }

  if (pending.length === 0) {
    console.log(colour.ok(`  up to date — ${applied.size} migration(s) applied`))
    console.log(colour.dim('  verify with: node scripts/doctor.mjs --url ' + url + '\n'))
    return
  }

  console.log(colour.dim(`  ${applied.size} applied, ${pending.length} pending`))

  if (args['dry-run']) {
    for (const m of pending) console.log(`  ${colour.warn('would apply')} ${m.name}`)
    console.log()
    return
  }

  for (const m of pending) {
    process.stdout.write(`  applying ${m.name} … `)
    try {
      // The stamp travels with the migration in one request, so the two cannot
      // disagree: either both land or neither does.
      await runSql({ ref, token, sql: `${m.sql}\n;\n${stamp(m)}` })
      console.log(colour.ok('ok'))
    } catch (err) {
      console.log(colour.bad('failed'))
      console.error(`\n${err.message}\n`)
      console.error(colour.warn(`Stopped at ${m.name}. It was rolled back, and later migrations were not applied.`))
      console.error(colour.warn('Fix the migration and re-run — nothing needs undoing by hand.'))
      process.exit(1)
    }
  }

  console.log(colour.ok(`\n  done — ${pending.length} applied`))
  console.log(colour.dim(`  now verify: node scripts/doctor.mjs --url ${url}\n`))
}

main().catch(err => {
  console.error(colour.bad(err instanceof AdminError ? err.message : String(err?.stack || err)))
  process.exit(1)
})
