/**
 * Talking to a client's Supabase project as an administrator.
 *
 * Two different credentials are involved and they are not interchangeable:
 *
 *   SUPABASE_ACCESS_TOKEN  a personal access token from
 *                          supabase.com/dashboard/account/tokens.
 *                          One token covers every project you own, which is
 *                          why provisioning uses it. Needed to run DDL.
 *
 *   service role key       per project, found in that project's API settings.
 *                          Bypasses RLS but cannot run DDL. Enough for the
 *                          doctor, which only reads the schema.
 *
 * Prefer the environment over flags for both: a key on the command line lands
 * in shell history and is visible to every process on the machine.
 *
 * The SQL endpoint is marked experimental by Supabase, so every call goes
 * through runSql() below — if it changes, this is the only thing to rewrite.
 */

const MANAGEMENT_API = 'https://api.supabase.com'
const SQL_TIMEOUT_MS = 120_000

export class AdminError extends Error {}

/** Pull a project ref out of a Supabase URL: https://<ref>.supabase.co */
export function refFromUrl(url) {
  // Anchored at both ends so an unrelated host cannot yield a plausible ref.
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i.exec(String(url || '').trim())
  if (!m) {
    throw new AdminError(
      `Not a Supabase project URL: ${url || '(empty)'}\nExpected https://<ref>.supabase.co`
    )
  }
  return m[1]
}

/**
 * Run SQL against a project. Multi-statement strings run as one implicit
 * transaction, so a migration file either lands whole or not at all.
 */
export async function runSql({ ref, token, sql, readOnly = false }) {
  if (!token) throw new AdminError('No access token. Set SUPABASE_ACCESS_TOKEN, or use --print.')

  let res
  try {
    res = await fetch(`${MANAGEMENT_API}/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: readOnly }),
      signal: AbortSignal.timeout(SQL_TIMEOUT_MS),
    })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new AdminError(
        `Timed out after ${SQL_TIMEOUT_MS / 1000}s talking to project ${ref}.\n` +
          'The statement may or may not have been applied — check the project before re-running.'
      )
    }
    throw new AdminError(`Could not reach the Supabase Management API: ${err?.message || err}`)
  }

  const text = await res.text()
  if (!res.ok) {
    throw new AdminError(`SQL failed (HTTP ${res.status}) on project ${ref}:\n${text.slice(0, 1500)}`)
  }

  // A 2xx body that is not JSON means the API changed shape. Treating it as an
  // empty result set would make the ledger look empty and re-run everything.
  if (text.trim() === '') return []
  try {
    return JSON.parse(text)
  } catch {
    throw new AdminError(
      `The Management API returned a 2xx response that is not JSON. Refusing to guess.\n${text.slice(0, 500)}`
    )
  }
}

/**
 * A project's live schema, as {table: {column: type}}.
 *
 * Read from PostgREST's own OpenAPI document rather than information_schema,
 * so it needs only the service role key — no personal access token. What it
 * cannot see (defaults, checks, policies) is deliberately out of scope; see
 * checkObjects() for the things that are checked separately.
 */
export async function fetchSchema({ url, serviceKey }) {
  const res = await fetch(`${String(url).replace(/\/$/, '')}/rest/v1/`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  if (!res.ok) {
    const hint =
      res.status === 401
        ? " That key cannot read the schema — use the project's service role key (Project Settings → API), not the publishable key."
        : ''
    throw new AdminError(`Could not read schema from ${url} (HTTP ${res.status}).${hint}`)
  }
  const doc = await res.json()
  const defs = doc.definitions || {}
  const schema = {}
  for (const [table, spec] of Object.entries(defs)) {
    schema[table] = Object.fromEntries(
      Object.entries(spec.properties || {}).map(([c, m]) => [c, m.format || '?'])
    )
  }
  // PostgREST lists callable functions under paths as /rpc/<name>.
  const rpcs = Object.keys(doc.paths || {})
    .filter(p => p.startsWith('/rpc/'))
    .map(p => p.slice(5))
  return { schema, rpcs }
}

/** Read `--flag value`, `--flag=value` and bare `--flag` off argv. */
export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    // Split on the FIRST '=' only: keys and URLs legitimately contain '='.
    const eq = a.indexOf('=')
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1)
    } else {
      const key = a.slice(2)
      const next = argv[i + 1]
      out[key] = next !== undefined && !next.startsWith('--') ? (i++, next) : true
    }
  }
  return out
}

/** A flag that must carry a real value — `--url` with nothing after it is an error, not `true`. */
export function requireValue(args, name, fallback, { what }) {
  const raw = args[name] !== undefined ? args[name] : fallback
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new AdminError(`Missing ${what}. Pass --${name} <value> or set the environment variable.`)
  }
  return raw.trim()
}

export const colour = {
  ok: s => `\x1b[32m${s}\x1b[0m`,
  bad: s => `\x1b[31m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
}
