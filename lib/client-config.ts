const name = process.env.NEXT_PUBLIC_CLIENT_NAME || 'SimpliiTrash'
const shortName = process.env.NEXT_PUBLIC_CLIENT_SHORT_NAME || 'ST'
const iconPrefix = process.env.NEXT_PUBLIC_CLIENT_ICON_PREFIX || 'icon'

export const CLIENT_CONFIG = {
  name,
  shortName,
  tagline: process.env.NEXT_PUBLIC_CLIENT_TAGLINE || '',
  yardAddress: process.env.NEXT_PUBLIC_CLIENT_YARD_ADDRESS || '',
  // Bin tracking is NOT here any more. It was NEXT_PUBLIC_CLIENT_REQUIRE_BIN,
  // which made it a deploy-time setting; it is now the `binNumbers` toggle on
  // /setup, stored per client in app_settings. Read it with useModules().
  // Sales tax on invoices. Ontario HST 13% by default; override per tenant/province.
  taxLabel: process.env.NEXT_PUBLIC_CLIENT_TAX_LABEL || 'HST',
  taxRate: Number(process.env.NEXT_PUBLIC_CLIENT_TAX_RATE ?? '13'),
  logoUrl: process.env.NEXT_PUBLIC_CLIENT_LOGO_URL || null,
  iconUrl: process.env.NEXT_PUBLIC_CLIENT_ICON_URL || null,
  // The single UI accent — icon tiles, active states, primary actions.
  // Set per tenant to that client's brand colour (SimpliiTrash green, BR red).
  // Pick a shade dark enough for white text; the tinted variants are derived
  // from it in globals.css (--accent-soft / --accent-ring / --accent-hover).
  primaryColor: process.env.NEXT_PUBLIC_CLIENT_PRIMARY_COLOR || '#0f766e',
  secondaryColor: process.env.NEXT_PUBLIC_CLIENT_SECONDARY_COLOR || '#0f172a',
  themeStorageKey: `${shortName.toLowerCase()}-theme`,
  swCacheName: `${shortName.toLowerCase()}-driver-v2`,
  emailPlaceholder: process.env.NEXT_PUBLIC_CLIENT_EMAIL_PLACEHOLDER || `you@${name.toLowerCase().replace(/\s+/g, '')}.com`,
  // Contact URI the push services see. Derived per tenant so no client's
  // address is ever baked in as another client's default.
  vapidSubject:
    process.env.VAPID_SUBJECT || `mailto:admin@${name.toLowerCase().replace(/\s+/g, '')}.com`,
  icon192: `/icons/${iconPrefix}-192.png`,
  icon512: `/icons/${iconPrefix}-512.png`,
}
