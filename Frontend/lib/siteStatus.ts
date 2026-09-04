'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from './api'

/**
 * Which public features the API is currently serving.
 *
 * Mirrors Backend/app/services/suspension.py. The backend is the single source
 * of truth — this is only here so a suspended feature renders a maintenance
 * notice instead of letting a 503 surface as a broken page.
 */
export type SiteStatus = {
  gallery_enabled: boolean
  checkout_enabled: boolean
  import_enabled: boolean
  message: string
}

export const DEFAULT_SUSPENSION_MESSAGE =
  'This part of MNS Studio is temporarily unavailable while we review the gallery. ' +
  'Your saved designs are unaffected. Please check back soon.'

// Fail closed, exactly as the backend does. If /site-status cannot be reached we
// assume suspended rather than open: the failure we care about is showing the
// public gallery during a takedown review, and a transient blip briefly showing
// a maintenance notice costs nothing by comparison.
const SUSPENDED: SiteStatus = {
  gallery_enabled: false,
  checkout_enabled: false,
  import_enabled: false,
  message: DEFAULT_SUSPENSION_MESSAGE,
}

export async function fetchSiteStatus(): Promise<SiteStatus> {
  try {
    const res = await fetch(`${API_BASE}/site-status`, { cache: 'no-store' })
    if (!res.ok) return SUSPENDED
    const json = (await res.json()) as Partial<SiteStatus>
    return {
      gallery_enabled: Boolean(json.gallery_enabled),
      checkout_enabled: Boolean(json.checkout_enabled),
      import_enabled: Boolean(json.import_enabled),
      message: json.message || DEFAULT_SUSPENSION_MESSAGE,
    }
  } catch {
    return SUSPENDED
  }
}

/** `status` is null only while the first fetch is in flight. */
export function useSiteStatus(): { status: SiteStatus | null; loading: boolean } {
  const [status, setStatus] = useState<SiteStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchSiteStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { status, loading }
}
