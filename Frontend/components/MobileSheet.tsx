'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Fraction of viewport height visible at the half snap point. */
  halfRatio?: number
  /** Fraction of viewport height occupied when fully expanded. */
  fullRatio?: number
  initialSnap?: 'half' | 'full'
  zIndex?: number
}

export default function MobileSheet({
  open,
  onClose,
  children,
  halfRatio = 0.45,
  fullRatio = 0.85,
  initialSnap = 'half',
  zIndex = 200,
}: Props) {
  const [viewportHeight, setViewportHeight] = useState(800)
  const [snap, setSnap] = useState<'half' | 'full'>(initialSnap)
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const dragStartRef = useRef<{ pointerId: number; clientY: number; baseOffset: number } | null>(null)

  useEffect(() => {
    const update = () => setViewportHeight(window.innerHeight)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    if (open) setSnap(initialSnap)
  }, [open, initialSnap])

  const sheetHeight = Math.round(viewportHeight * fullRatio)
  const halfVisible = Math.round(viewportHeight * halfRatio)
  const snapOffsets = { full: 0, half: sheetHeight - halfVisible }
  const restingOffset = open ? snapOffsets[snap] : sheetHeight
  const currentOffset = dragOffset ?? restingOffset

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragStartRef.current = {
        pointerId: event.pointerId,
        clientY: event.clientY,
        baseOffset: snapOffsets[snap],
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [snap, snapOffsets.half]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current
      if (!start || start.pointerId !== event.pointerId) return
      const delta = event.clientY - start.clientY
      setDragOffset(Math.min(sheetHeight, Math.max(0, start.baseOffset + delta)))
    },
    [sheetHeight]
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current
      if (!start || start.pointerId !== event.pointerId) return
      dragStartRef.current = null
      const offset = dragOffset ?? snapOffsets[snap]
      setDragOffset(null)

      const candidates: Array<{ target: 'full' | 'half' | 'closed'; at: number }> = [
        { target: 'full', at: 0 },
        { target: 'half', at: snapOffsets.half },
        { target: 'closed', at: sheetHeight },
      ]
      const nearest = candidates.reduce((best, c) =>
        Math.abs(c.at - offset) < Math.abs(best.at - offset) ? c : best
      )
      if (nearest.target === 'closed') {
        onClose()
      } else {
        setSnap(nearest.target)
      }
    },
    [dragOffset, onClose, sheetHeight, snap, snapOffsets.half]
  )

  return (
    <>
      {open && snap === 'full' && dragOffset === null && (
        <div
          onClick={() => setSnap('half')}
          style={{ position: 'fixed', inset: 0, zIndex: zIndex - 1, background: 'rgba(0,0,0,0.3)' }}
        />
      )}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: sheetHeight,
          zIndex,
          background: '#fffdf8',
          borderRadius: '16px 16px 0 0',
          borderTop: '2px solid #e0d9cf',
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          transform: `translateY(${currentOffset}px)`,
          transition: dragOffset === null ? 'transform 0.28s cubic-bezier(0.4,0,0.2,1)' : 'none',
          overflow: 'hidden',
          pointerEvents: open ? 'auto' : 'none',
          boxShadow: open ? '0 -4px 24px rgba(0,0,0,0.10)' : 'none',
        }}
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 16px 6px',
            touchAction: 'none',
            cursor: 'grab',
          }}
        >
          <div style={{ width: 44 }} />
          <div style={{ width: 44, height: 5, borderRadius: 999, background: '#d5cec6' }} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            style={{
              border: 0, background: 'none', fontSize: 18, color: '#9a9287',
              cursor: 'pointer', width: 44, height: 32, lineHeight: 1, textAlign: 'right',
            }}
          >✕</button>
        </div>
        <div style={{ minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
      </div>
    </>
  )
}
