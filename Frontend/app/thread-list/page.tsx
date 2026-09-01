'use client'

import { type CSSProperties, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type ThreadListRow = {
  hex: string
  dmc_code: string
  dmc_name: string
  count: number
  skeins: number
}

type ThreadListPayload = {
  width_inches: number
  height_inches: number
  mesh_count: number
  colors_used: number
  total_stitches: number
  rows: ThreadListRow[]
}

const page: CSSProperties = {
  minHeight: '100vh',
  maxWidth: 560,
  margin: '0 auto',
  padding: '28px 18px 60px',
}

const summaryCard: CSSProperties = {
  background: '#fff',
  border: '1px solid #e7e1d8',
  borderRadius: 12,
  padding: '16px 18px',
  marginBottom: 18,
}

const rowCard: CSSProperties = {
  background: '#fff',
  border: '1px solid #e7e1d8',
  borderRadius: 12,
  padding: '14px 16px',
  marginBottom: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
}

function ThreadListPage() {
  const searchParams = useSearchParams()
  const src = searchParams.get('src')
  const [data, setData] = useState<ThreadListPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!src) {
      setError('No color list was linked here.')
      setLoading(false)
      return
    }
    let cancelled = false
    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((json: ThreadListPayload) => {
        if (!cancelled) setData(json)
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this color list. It may have expired.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [src])

  return (
    <div style={page}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: '#7A817A', textTransform: 'uppercase' }}>
          MNS Studio
        </div>
        <h1 style={{ margin: '4px 0 0', fontSize: 24 }}>Thread shopping list</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6f675f', lineHeight: 1.5 }}>
          DMC codes and names for this design — take this to a thread store or search these codes online.
        </p>
      </div>

      {loading && <p style={{ color: '#8a8177', fontSize: 14 }}>Loading…</p>}
      {error && <p style={{ color: '#b0453a', fontSize: 14 }}>{error}</p>}

      {data && (
        <>
          <div style={summaryCard}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
              <div><strong>Size</strong> — {data.width_inches}&quot; × {data.height_inches}&quot;</div>
              <div><strong>Mesh</strong> — {data.mesh_count}</div>
              <div><strong>Colors</strong> — {data.colors_used}</div>
              <div><strong>Stitches</strong> — {data.total_stitches.toLocaleString()}</div>
            </div>
          </div>

          <p style={{ fontSize: 12, color: '#8a8177', margin: '0 0 12px' }}>
            Skein counts are estimates — buy an extra skein of anything you're unsure about.
          </p>

          {data.rows.map((row) => (
            <div key={row.dmc_code} style={rowCard}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  background: row.hex,
                  border: '1px solid rgba(0,0,0,0.12)',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>DMC {row.dmc_code}</div>
                <div style={{ fontSize: 13, color: '#6f675f' }}>{row.dmc_name}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{row.skeins} {row.skeins === 1 ? 'skein' : 'skeins'}</div>
                <div style={{ fontSize: 12, color: '#8a8177' }}>{row.count.toLocaleString()} stitches</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export default function ThreadListPageWrapper() {
  return (
    <Suspense>
      <ThreadListPage />
    </Suspense>
  )
}
