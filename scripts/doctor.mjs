#!/usr/bin/env node
/**
 * Check a client's project has everything the app needs.
 *
 *   node scripts/doctor.mjs                              # project in .env.local
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/doctor.mjs
 *
 * Only needs that project's service role key — no personal access token — so it
 * can be run the moment you have the client's keys.
 *
 * Prefer the environment over flags: a key passed on the command line lands in
 * shell history and is visible to every process on the machine.
 *
 * A green result here is a promise that onboarding worked, so this file is
 * careful to say what it did NOT check rather than imply everything is fine.
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AdminError, colour, fetchSchema, parseArgs } from './lib/admin.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXPECTED = join(HERE, '..', 'db', 'expected-schema.json')

/** Functions and buckets the migrations create and the app calls by name. */
const REQUIRED_RPCS = ['adjust_stock']
const REQUIRED_BUCKETS = ['delivery-photos']

/** Read a key out of .env.local without pulling in a dotenv dependency. */
async function fromEnvFile(name) {
  try {
    const text = await readFile(join(HERE, '..', '.env.local'), 'utf8')
    const line = text.split('\n').find(l => l.startsWith(`${name}=`))
    if (!line) return null
    let v = line.slice(name.length + 1).trim()
    // Strip matching quotes, which would otherwise produce a confusing 401.
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    return v || null
  } catch {
    return null
  }
}

async function checkBuckets({ url, serviceKey }) {
  const res = await fetch(`${url.replace(/\/$/, '')}/storage/v1/bucket`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  if (!res.ok) return null // storage unreachable — reported as unknown, not as pass
  const buckets = await res.json()
  return Array.isArray(buckets) ? buckets : null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const url =
    (typeof args.url === 'string' && args.url) ||
    process.env.SUPABASE_URL ||
    (await fromEnvFile('NEXT_PUBLIC_SUPABASE_URL'))
  const key =
    (typeof args.key === 'string' && args.key) ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (await fromEnvFile('SUPABASE_SERVICE_ROLE_KEY'))

  if (!url || !key) {
    console.error(`Usage: node scripts/doctor.mjs [--url https://<ref>.supabase.co]

Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment, falling
back to NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local.`)
    process.exit(2)
  }

  const expected = JSON.parse(await readFile(EXPECTED, 'utf8'))
  const { schema: actual, rpcs } = await fetchSchema({ url, serviceKey: key })

  console.log(colour.bold(`\nChecking ${url}\n`))

  let missingTables = 0
  let missingColumns = 0
  const typeDrift = []

  for (const [table, columns] of Object.entries(expected)) {
    const live = actual[table]
    if (!live) {
      missingTables++
      console.log(`  ${colour.bad('MISSING')}  ${table}`)
      continue
    }
    const gone = Object.keys(columns).filter(c => !(c in live))
    for (const [c, want] of Object.entries(columns)) {
      if (c in live && live[c] !== want) typeDrift.push(`${table}.${c} — expected ${want}, found ${live[c]}`)
    }
    if (gone.length) {
      missingColumns += gone.length
      console.log(`  ${colour.warn('PARTIAL')}  ${table} — missing ${gone.join(', ')}`)
    } else {
      console.log(`  ${colour.ok('ok')}       ${table} ${colour.dim(`(${Object.keys(columns).length} cols)`)}`)
    }
  }

  // Functions. adjust_stock is the only safe way stock is ever moved; without it
  // every sale and every order silently fails to adjust inventory.
  console.log()
  const missingRpcs = REQUIRED_RPCS.filter(r => !rpcs.includes(r))
  for (const r of REQUIRED_RPCS) {
    console.log(`  ${rpcs.includes(r) ? colour.ok('ok') : colour.bad('MISSING')}       rpc ${r}()`)
  }

  // Storage.
  const buckets = await checkBuckets({ url, serviceKey: key })
  let missingBuckets = 0
  let bucketsUnknown = buckets === null
  if (bucketsUnknown) {
    console.log(`  ${colour.warn('UNKNOWN')}  storage buckets — could not read the storage API`)
  } else {
    for (const b of REQUIRED_BUCKETS) {
      const found = buckets.find(x => x.id === b || x.name === b)
      if (!found) {
        missingBuckets++
        console.log(`  ${colour.bad('MISSING')}  bucket ${b}`)
      } else if (!found.public) {
        missingBuckets++
        console.log(`  ${colour.bad('PRIVATE')}  bucket ${b} — must be public for getPublicUrl to work`)
      } else {
        console.log(`  ${colour.ok('ok')}       bucket ${b}`)
      }
    }
  }

  if (typeDrift.length) {
    console.log(colour.warn(`\n  type differences (not fatal, but the two populations diverge):`))
    for (const d of typeDrift) console.log(colour.dim(`    ${d}`))
  }

  const extra = Object.keys(actual).filter(t => !(t in expected))
  if (extra.length) {
    console.log(colour.dim(`\n  not in the reference schema (legacy, ignored): ${extra.join(', ')}`))
  }

  const problems = missingTables + missingColumns + missingRpcs.length + missingBuckets

  // Say plainly what was not inspected. A green line that overstates its reach
  // is worse than a yellow one that is honest.
  const caveat =
    '  Not checked: RLS policies, column defaults, check constraints, sequences.' +
    (bucketsUnknown ? '\n  Not checked: storage buckets (unreachable).' : '')

  if (problems === 0) {
    console.log(colour.ok(`\n  All ${Object.keys(expected).length} tables, ${REQUIRED_RPCS.length} function(s) and ${REQUIRED_BUCKETS.length} bucket(s) present.`))
    console.log(colour.dim(caveat + '\n'))
    return
  }

  console.log(colour.bad(`\n  ${problems} problem(s).`))
  console.log(colour.dim(caveat))
  console.log(`\n  Run: node scripts/migrate.mjs --url ${url}`)
  console.log(`  Or without a token: node scripts/migrate.mjs --url ${url} --print\n`)
  process.exit(1)
}

main().catch(err => {
  console.error(colour.bad(err instanceof AdminError ? err.message : String(err?.stack || err)))
  process.exit(1)
})
