'use client'

import { formatCents } from '../lib/api'
import { useIsPhoneDevice } from '../lib/useViewport'

type Props = {
  pendingCents: number | null
  navHeight?: number
}

// Shared across studio and gallery so the credit indicator looks and
// behaves identically everywhere it appears, instead of drifting into
// page-specific badges/bars. Hidden on phones per product decision;
// iPad and desktop keep it.
export function CanvasCreditPill({ pendingCents, navHeight = 70 }: Props) {
  const isPhoneDevice = useIsPhoneDevice()
  if (isPhoneDevice || pendingCents === null || pendingCents <= 0) return null

    // Docked inside the nav bar itself (centered in the gap between the left
    // nav links and the right-side icons) rather than floating below it —
    // content below the nav varies by page/workflow step (e.g. the studio
    // tools panel starts flush under the nav with no gap in step 2), so
    // anything straddling that boundary collides with something eventually.
    // Staying inside the nav's own fixed space sidesteps that entirely.
  return (
    <div
      title="Canvas credit available"
      style={{
        position: 'fixed',
        top: navHeight / 2,
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 10001,
        background: '#e8f0e6',
        color: '#4a7244',
        border: '1px solid #c5d9c2',
        borderRadius: 999,
        padding: '4px 12px',
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
        pointerEvents: 'none',
      }}
    >
      🌿 {formatCents(pendingCents)} credit
    </div>
  )
}
