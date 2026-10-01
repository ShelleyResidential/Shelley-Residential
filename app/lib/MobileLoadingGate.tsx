'use client'

import { createContext, useCallback, useContext, useEffect, useRef } from 'react'

// Lets any mobile page (and MobileShell's own auth/profile fetch) register
// "I'm still loading" so MobileShell can hold a single full-screen splash
// over the whole app -- header included -- until everything the current
// page needs is actually ready, instead of the header appearing first and
// then the page's own "Loading…" text appearing a moment later underneath
// it. Safe to call from a page that's also rendered on desktop (no
// MobileShell/provider there): the default value is a no-op.
type GateContextValue = { setLoading: (key: string, loading: boolean) => void }
const GateContext = createContext<GateContextValue>({ setLoading: () => {} })

// Call with whatever boolean a page already uses to gate its own content --
// most pages already have exactly one of these, so this is usually a
// one-line addition. `key` only needs to be unique for the lifetime of one
// mounted page (the component's name is fine) so one page registering
// doesn't clobber another's entry.
export function useMobileLoadingGate(key: string, loading: boolean) {
  const { setLoading } = useContext(GateContext)
  useEffect(() => {
    setLoading(key, loading)
    // Unregister on unmount (navigating away mid-load) so a page that
    // never got to report "done" can't permanently block the gate.
    return () => setLoading(key, false)
  }, [key, loading, setLoading])
}

// MobileShell wraps its children in this. `ready` latches true the first
// time nothing registered is still loading, and -- deliberately -- never
// goes back to false after that: later in-app navigations shouldn't
// re-trigger the full splash, only the very first open should.
export function MobileLoadingProvider({ children, onReady }: {
  children: React.ReactNode
  onReady: () => void
}) {
  const pending = useRef<Set<string>>(new Set())
  const latched = useRef(false)

  const setLoading = useCallback((key: string, loading: boolean) => {
    if (loading) pending.current.add(key)
    else pending.current.delete(key)

    if (!latched.current && pending.current.size === 0) {
      latched.current = true
      onReady()
    }
  }, [onReady])

  return <GateContext.Provider value={{ setLoading }}>{children}</GateContext.Provider>
}
