'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_MODULES,
  MODULES_CACHE_KEY,
  resolveModules,
  type ModuleSettings,
} from '@/lib/settings'

type SettingsContextValue = {
  modules: ModuleSettings
  loading: boolean
  /** Re-read from the database — call after saving the setup page. */
  refresh: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue>({
  modules: DEFAULT_MODULES,
  loading: true,
  refresh: async () => {},
})

/** Last known settings, so the sidebar doesn't flicker while the fetch runs. */
function readCache(): ModuleSettings {
  if (typeof window === 'undefined') return DEFAULT_MODULES
  try {
    const raw = window.localStorage.getItem(MODULES_CACHE_KEY)
    return raw ? resolveModules(JSON.parse(raw)) : DEFAULT_MODULES
  } catch {
    return DEFAULT_MODULES
  }
}

function writeCache(m: ModuleSettings) {
  try {
    window.localStorage.setItem(MODULES_CACHE_KEY, JSON.stringify(m))
  } catch {
    // Private browsing or blocked storage — the network value still applies.
  }
}

export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [modules, setModules] = useState<ModuleSettings>(DEFAULT_MODULES)
  const [loading, setLoading] = useState(true)

  // Hydrate from cache after mount — reading localStorage during render
  // would differ between server and client markup.
  useEffect(() => {
    setModules(readCache())
  }, [])

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('app_settings')
      .select('modules')
      .maybeSingle()

    // A missing table (migration not run yet) or an unreadable row both mean
    // "no client setup saved" — fall back to defaults rather than breaking
    // the app. This is what makes the migration safe to run at any time.
    if (error || !data) {
      setLoading(false)
      return
    }

    const resolved = resolveModules(data.modules as Partial<ModuleSettings>)
    setModules(resolved)
    writeCache(resolved)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <SettingsContext.Provider value={{ modules, loading, refresh: load }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useModules() {
  return useContext(SettingsContext)
}
