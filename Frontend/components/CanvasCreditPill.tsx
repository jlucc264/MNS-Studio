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

  return (
    <div
      title="Canvas credit available"
      style={{
        position: 'fixed',
        top: navHeight - 12,
        right: 16,
        zIndex: 9999,
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
