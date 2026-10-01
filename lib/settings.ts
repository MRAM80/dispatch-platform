import { CLIENT_CONFIG } from '@/lib/client-config'

/**
 * Which parts of the product a client has switched on.
 *
 * These live in the client's own database (`app_settings`), not in env vars,
 * so a client's setup can change without a redeploy.
 *
 * Rule: a switch controls what is OFFERED from now on. It never hides or
 * deletes work that already exists — an order created while Disposal Sites
 * was on must keep loading, printing and billing correctly after it is
 * switched off.
 */
export type ModuleSettings = {
  /** Bin rental: the bins yard and the DELIVERY / EXCHANGE / REMOVAL / DUMP RETURN jobs. */
  binServices: boolean
  /** Track individual bin numbers. Off for clients who don't label their bins. */
  binNumbers: boolean
  /** Dump locations. Off removes EXCHANGE / REMOVAL / DUMP RETURN, which require one. */
  disposalSites: boolean
  /** Selling material delivered by the truck (MATERIAL DELIVERY + material on orders). */
  materialDelivery: boolean
  /** Counter sales: Quick Sale till, inventory and stock movements. */
  retail: boolean
  /** Expenses, the tax return and the QuickBooks export. */
  accounting: boolean
}

/**
 * What a client gets before they have saved a setup: everything on.
 *
 * `binNumbers` used to inherit NEXT_PUBLIC_CLIENT_REQUIRE_BIN, which made bin
 * tracking a deploy-time setting. That env var is gone — the toggle on /setup
 * owns it now — so a client who wants bin numbers off must save that choice.
 * Onboarding is not finished until System Setup has been saved once.
 */
export const DEFAULT_MODULES: ModuleSettings = {
  binServices: true,
  binNumbers: true,
  disposalSites: true,
  materialDelivery: true,
  retail: true,
  accounting: true,
}

/**
 * Apply the dependencies. Sub-options of a switched-off parent are themselves
 * off, so callers never have to remember the relationship.
 */
export function resolveModules(raw: Partial<ModuleSettings> | null | undefined): ModuleSettings {
  const m: ModuleSettings = { ...DEFAULT_MODULES, ...(raw || {}) }
  if (!m.binServices) {
    m.binNumbers = false
    m.disposalSites = false
  }
  return m
}

/**
 * The order types a client can create. The single place the
 * "EXCHANGE / REMOVAL / DUMP RETURN need a dump site" rule is expressed.
 */
export function enabledOrderTypes(m: ModuleSettings): string[] {
  const types: string[] = []
  if (m.binServices) {
    types.push('DELIVERY')
    if (m.disposalSites) types.push('EXCHANGE', 'REMOVAL', 'DUMP RETURN')
  }
  if (m.materialDelivery) types.push('MATERIAL DELIVERY')
  return types
}

/**
 * Which module a nav route belongs to. Routes absent from this map are core
 * and always visible.
 */
const ROUTE_MODULE: Record<string, keyof ModuleSettings> = {
  '/bins': 'binServices',
  '/dump-sites': 'disposalSites',
  '/sale': 'retail',
  '/inventory': 'retail',
  '/receiving': 'retail',
  '/expenses': 'accounting',
  '/reports/tax': 'accounting',
  '/export': 'accounting',
}

export function isRouteEnabled(href: string, m: ModuleSettings): boolean {
  const key = ROUTE_MODULE[href]
  return key ? m[key] : true
}

/** Shape stored in localStorage so the sidebar renders without waiting on the network. */
export const MODULES_CACHE_KEY = `${CLIENT_CONFIG.shortName.toLowerCase()}-modules`
