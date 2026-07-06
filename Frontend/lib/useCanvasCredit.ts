import { useEffect, useState } from 'react'
import { getCreatorEarnings } from './api'

export function useCanvasCredit(accessToken: string | null | undefined) {
  const [pendingCents, setPendingCents] = useState<number | null>(null)

  useEffect(() => {
    if (!accessToken) { setPendingCents(null); return }
    getCreatorEarnings(accessToken)
      .then(e => setPendingCents(e.pending_cents))
      .catch(() => setPendingCents(null))
  }, [accessToken])

  return pendingCents
}
