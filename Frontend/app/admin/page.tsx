'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import {
  listProjects,
  downloadBlankRollPdf,
  downloadCalibrationPdf,
  downloadRegistrationTestPdf,
  downloadRollPrintPdf,
  MAX_ROLL_WIDTH_INCHES,
  contentDimensionsInches,
  getCanvasForDesign,
  listCompletedPrintOrders,
  listPendingPrintOrders,
  listPrintRuns,
  markPrintOrdersPrinted,
  reopenPrintOrders,
  setPrintRunOutcome,
  type PrintOrder,
  type PrintRun,
  type Project,
} from '../../lib/api'

const styles = {
  page: {
    minHeight: '100vh',
    background: '#F7F5F0',
    fontFamily: 'Georgia, serif',
    padding: '48px 32px',
    maxWidth: 720,
    margin: '0 auto',
  } as const,
  h1: {
    fontSize: 24,
    fontWeight: 700,
    color: '#173F2A',
    marginBottom: 6,
  } as const,
  subtitle: {
    fontSize: 13,
    color: '#7A817A',
    marginBottom: 40,
  } as const,
  section: {
    background: '#fff',
    border: '1px solid #E8E4DC',
    borderRadius: 12,
    padding: '24px 28px',
    marginBottom: 24,
  } as const,
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#2D332F',
    marginBottom: 6,
  } as const,
  sectionDesc: {
    fontSize: 12,
    color: '#7A817A',
    marginBottom: 18,
    lineHeight: 1.5,
  } as const,
  btn: {
    padding: '9px 20px',
    border: '1px solid #5c7856',
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    background: '#6e8d67',
    color: '#fff',
  } as const,
  btnSecondary: {
    padding: '9px 20px',
    border: '1px solid #D7D0C8',
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    background: '#fff',
    color: '#3A413B',
  } as const,
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  } as const,
  projectList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    marginBottom: 20,
    maxHeight: 320,
    overflowY: 'auto' as const,
  } as const,
  projectRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    border: '1px solid #E8E4DC',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#FAFAF8',
    fontSize: 13,
    color: '#2D332F',
  } as const,
  projectRowSelected: {
    border: '1px solid #6e8d67',
    background: '#F0F4EF',
  } as const,
  selectedBadge: {
    fontSize: 11,
    background: '#6e8d67',
    color: '#fff',
    borderRadius: 4,
    padding: '1px 6px',
  } as const,
  copiesRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    fontSize: 13,
    color: '#2D332F',
  } as const,
  copiesInput: {
    width: 64,
    padding: '6px 10px',
    border: '1px solid #D7D0C8',
    borderRadius: 6,
    fontFamily: 'inherit',
    fontSize: 13,
    color: '#2D332F',
  } as const,
  error: {
    marginTop: 12,
    fontSize: 12,
    color: '#B03A2E',
  } as const,
  orderNote: {
    marginTop: 14,
    fontSize: 11,
    color: '#7A817A',
  } as const,
}

// Calibration is per-machine and admin-only, so it lives in the browser rather
// than costing a Supabase table. Keyed by roll width as a string.
type Calibration = { yScale: number; xOffsetInches: number; skewCorrectionInches: number }
const CALIBRATION_KEY = 'mns_roll_calibration_v1'

function loadCalibration(): Record<string, Calibration> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(CALIBRATION_KEY) ?? '{}') as Record<string, Calibration>
  } catch {
    return {}
  }
}

function saveCalibration(rollWidth: number, values: Calibration) {
  if (typeof window === 'undefined') return
  try {
    const all = loadCalibration()
    all[String(rollWidth)] = values
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(all))
  } catch {
    /* private browsing or quota — calibration just won't persist */
  }
}

export default function AdminPage() {
  const { session, loading } = useAuth()
  const router = useRouter()

  const [projects, setProjects] = useState<Project[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [orders, setOrders] = useState<PrintOrder[]>([])
  const [completed, setCompleted] = useState<PrintOrder[]>([])
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [ordersError, setOrdersError] = useState('')
  const [orderBusyId, setOrderBusyId] = useState('')
  const [runBusyId, setRunBusyId] = useState('')
  const [runs, setRuns] = useState<PrintRun[]>([])
  const [copies, setCopies] = useState(1)
  const [rollWidthInches, setRollWidthInches] = useState(MAX_ROLL_WIDTH_INCHES)
  const [gapInches, setGapInches] = useState(0)
  // Empty string = match the top/bottom canvas margin (previous behaviour).
  const [sideMarginInches, setSideMarginInches] = useState('')
  const [logoXOffsetInches, setLogoXOffsetInches] = useState(0)
  const [logoYOffsetInches, setLogoYOffsetInches] = useState(0)
  const [xOffsetInches, setXOffsetInches] = useState(0)
  const [skewCorrectionInches, setSkewCorrectionInches] = useState(0)
  const [yScale, setYScale] = useState(1.0)
  const [includeAlignmentTest, setIncludeAlignmentTest] = useState(false)
  const [calibBusy, setCalibBusy] = useState(false)
  const [regBusy, setRegBusy] = useState(false)
  const [blankBusy, setBlankBusy] = useState(false)
  const [rollBusy, setRollBusy] = useState(false)
  const [calibError, setCalibError] = useState('')
  const [regError, setRegError] = useState('')
  const [blankError, setBlankError] = useState('')
  const [rollError, setRollError] = useState('')
  const [calibrationNote, setCalibrationNote] = useState('')

  useEffect(() => {
    if (!loading && !session) router.replace('/studio')
  }, [loading, session, router])

  useEffect(() => {
    if (!session) return
    listProjects(session.access_token).then(setProjects).catch(() => {})
  }, [session])

  // Paid-and-waiting orders. Until now this endpoint existed with nothing
  // calling it, so the only record of what to print was the order email.
  const refreshOrders = useCallback(() => {
    if (!session) return
    listPendingPrintOrders(session.access_token)
      .then(setOrders)
      .catch(() => setOrdersError('Could not load pending orders.'))
    listCompletedPrintOrders(session.access_token, 40).then(setCompleted).catch(() => {})
  }, [session])

  useEffect(refreshOrders, [refreshOrders])

  // Retiring an order is the one irreversible-feeling step in the flow, so it
  // is its own click, made after the canvas is off the roll — not a side
  // effect of downloading a PDF that might still print badly.
  async function confirmPrinted(id: string) {
    if (!session) return
    setOrderBusyId(id)
    try {
      await markPrintOrdersPrinted([id], session.access_token)
      setSelectedOrderIds(prev => prev.filter(x => x !== id))
      refreshOrders()
    } catch {
      setOrdersError('Could not mark that order printed.')
    } finally {
      setOrderBusyId('')
    }
  }

  async function reopenOrder(id: string) {
    if (!session) return
    setOrderBusyId(id)
    try {
      await reopenPrintOrders([id], session.access_token)
      refreshOrders()
    } catch {
      setOrdersError('Could not move that order back to the queue.')
    } finally {
      setOrderBusyId('')
    }
  }

  function refreshRuns() {
    if (!session) return
    listPrintRuns(session.access_token, 15).then(setRuns).catch(() => {})
  }

  useEffect(refreshRuns, [session])

  // Judging a run is what makes the log usable: several PDFs usually precede a
  // good one, and without a verdict every row looks equally trustworthy.
  async function judgeRun(r: PrintRun, outcome: 'good' | 'bad' | null) {
    if (!session) return
    setRunBusyId(r.id)
    try {
      await setPrintRunOutcome(r.id, outcome, session.access_token)
      refreshRuns()
    } catch {
      setRollError('Could not save that verdict.')
    } finally {
      setRunBusyId('')
    }
  }

  function reuseRun(r: PrintRun) {
    if (r.roll_width_inches != null) setRollWidthInches(r.roll_width_inches)
    if (r.copies != null) setCopies(r.copies)
    if (r.y_scale != null) setYScale(r.y_scale)
    if (r.x_offset_inches != null) setXOffsetInches(r.x_offset_inches)
    if (r.skew_correction_inches != null) setSkewCorrectionInches(r.skew_correction_inches)
    if (r.gap_inches != null) setGapInches(r.gap_inches)
    if (r.logo_x_offset_inches != null) setLogoXOffsetInches(r.logo_x_offset_inches)
    if (r.logo_y_offset_inches != null) setLogoYOffsetInches(r.logo_y_offset_inches)
    setSideMarginInches(r.side_margin_inches == null ? '' : String(r.side_margin_inches))
    setCalibrationNote(
      `Reused settings from ${new Date(r.created_at).toLocaleDateString()} `
      + `(${r.roll_width_inches ?? '?'}″ roll, ${r.page_length_inches ?? '?'}″ page)`
      + (r.outcome === 'good' ? ' — a run you marked good.'
        : r.outcome === 'bad' ? ' — WARNING: you marked this run as failed.'
        : ' — this run was never judged, so these numbers are unverified.')
    )
  }

  // Roller speed varies with the width of the loaded roll, so a Y scale
  // calibrated on an 8" roll is wrong on a 17" one. Re-deriving it means
  // burning large canvas to find the number again, so each width remembers
  // its own. Offset and skew ride along — they're re-measured in the same
  // pass and drift for the same reason.
  useEffect(() => {
    const saved = loadCalibration()[String(rollWidthInches)]
    if (!saved) return
    setYScale(saved.yScale)
    setXOffsetInches(saved.xOffsetInches)
    setSkewCorrectionInches(saved.skewCorrectionInches)
    setCalibrationNote(`Loaded saved calibration for ${rollWidthInches}″ roll.`)
  }, [rollWidthInches])

  function toggleOrder(id: string) {
    setSelectedOrderIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )
  }

  function toggleProject(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )
  }

  async function handleCalibration(nozzle = true, cellSize = 1, rows?: number, header = true, instructions = true) {
    if (!session) return
    setCalibBusy(true)
    setCalibError('')
    try {
      await downloadCalibrationPdf(session.access_token, nozzle, cellSize, rows, header, instructions)
    } catch (e: unknown) {
      setCalibError(e instanceof Error ? e.message : 'Error')
    } finally {
      setCalibBusy(false)
    }
  }

  async function handleRegistrationTest() {
    if (!session) return
    setRegBusy(true)
    setRegError('')
    try {
      await downloadRegistrationTestPdf(session.access_token)
    } catch (e: unknown) {
      setRegError(e instanceof Error ? e.message : 'Error')
    } finally {
      setRegBusy(false)
    }
  }

  async function handleBlankRoll() {
    if (!session) return
    setBlankBusy(true)
    setBlankError('')
    try {
      await downloadBlankRollPdf(session.access_token)
    } catch (e: unknown) {
      setBlankError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBlankBusy(false)
    }
  }

  async function handleRollPrint() {
    if (!session || (selectedIds.length === 0 && selectedOrderIds.length === 0 && !includeAlignmentTest)) return
    setRollBusy(true)
    setRollError('')
    try {
      await downloadRollPrintPdf(selectedIds, session.access_token, {
        printOrderIds: selectedOrderIds,
        copies,
        rollWidthInches,
        gapInches,
        sideMarginInches: sideMarginInches === '' ? null : parseFloat(sideMarginInches),
        logoXOffsetInches,
        logoYOffsetInches,
        xOffsetInches,
        skewCorrectionInches,
        yScale,
        includeAlignmentTest,
      })
      // Only persist once a print actually generated — a width whose values
      // errored out isn't a calibration worth remembering.
      saveCalibration(rollWidthInches, { yScale, xOffsetInches, skewCorrectionInches })
      setCalibrationNote(`Saved calibration for ${rollWidthInches}″ roll.`)
      // Orders deliberately stay selected and in the queue — the PDF is only
      // stamped "PDF sent". They leave when you tick the check, after seeing
      // the canvas come off the roll.
      if (selectedOrderIds.length) refreshOrders()
      refreshRuns()
    } catch (e: unknown) {
      setRollError(e instanceof Error ? e.message : 'Error')
    } finally {
      setRollBusy(false)
    }
  }

  if (loading || !session) return null

  const selectedCount = selectedIds.length + selectedOrderIds.length
  const orderedDesigns = selectedCount > 0
    ? `${selectedCount} design${selectedCount === 1 ? '' : 's'}`
      + (selectedOrderIds.length ? ` (${selectedOrderIds.length} from orders)` : '')
      + ` × ${copies} cop${copies === 1 ? 'y' : 'ies'} = ${selectedCount * copies} total`
    : null

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Roll Print Admin</h1>
      <p style={styles.subtitle}>P900 · 18 mesh · up to {MAX_ROLL_WIDTH_INCHES}″ roll · admin only</p>

      {/* Calibration */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Calibration Page</div>
        <div style={styles.sectionDesc}>
          Print this first when loading a new roll. Includes a nozzle check strip and a 6×4 inch
          grid — measure any square against a ruler before committing to canvas.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            style={{ ...styles.btn, ...(calibBusy ? styles.btnDisabled : {}) }}
            onClick={() => handleCalibration(true)}
            disabled={calibBusy}
          >
            {calibBusy ? 'Generating…' : 'With Nozzle Check'}
          </button>
          <button
            style={{ ...styles.btnSecondary, ...(calibBusy ? styles.btnDisabled : {}) }}
            onClick={() => handleCalibration(false)}
            disabled={calibBusy}
          >
            Grid Only
          </button>
          <button
            style={{ ...styles.btnSecondary, ...(calibBusy ? styles.btnDisabled : {}) }}
            onClick={() => handleCalibration(false, 1, 8)}
            disabled={calibBusy}
          >
            2× Grid
          </button>
          <button
            style={{ ...styles.btnSecondary, ...(calibBusy ? styles.btnDisabled : {}) }}
            onClick={() => handleCalibration(true, 1, 2, false, false)}
            disabled={calibBusy}
          >
            Recal
          </button>
        </div>
        {calibError && <div style={styles.error}>{calibError}</div>}
      </div>

      {/* Registration test */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Registration Test</div>
        <div style={styles.sectionDesc}>
          Print on a cut sheet via rear feed, re-feed, and print again — crosshairs must land
          exactly on top of each other to confirm second-pass registration is viable.
        </div>
        <button
          style={{ ...styles.btnSecondary, ...(regBusy ? styles.btnDisabled : {}) }}
          onClick={handleRegistrationTest}
          disabled={regBusy}
        >
          {regBusy ? 'Generating…' : 'Download Registration Test PDF'}
        </button>
        {regError && <div style={styles.error}>{regError}</div>}
      </div>

      {/* Blank roll */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Blank Roll Page</div>
        <div style={styles.sectionDesc}>
          Prints a blank 8″ × 4″ page — feed through and cut for a clean leading edge.
        </div>
        <button
          style={{ ...styles.btnSecondary, ...(blankBusy ? styles.btnDisabled : {}) }}
          onClick={handleBlankRoll}
          disabled={blankBusy}
        >
          {blankBusy ? 'Generating…' : 'Download Blank Roll PDF'}
        </button>
        {blankError && <div style={styles.error}>{blankError}</div>}
      </div>

      {/* Roll print */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Roll Print PDF</div>
        <div style={styles.sectionDesc}>
          Select paid orders and/or your own designs, in print order. Each prints at true size,
          centered on the roll width you set below, with a cut line between them. Orders stay in
          the queue after the PDF downloads — tick the ✓ once the canvas is off the roll and good.
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: '#2D332F', marginBottom: 8 }}>
          Pending orders{orders.length > 0 ? ` (${orders.length})` : ''}
        </div>
        <div style={styles.projectList}>
          {orders.map(o => {
            const selected = selectedOrderIds.includes(o.id)
            const idx = selectedOrderIds.indexOf(o.id)
            return (
              <div
                key={o.id}
                style={{ ...styles.projectRow, ...(selected ? styles.projectRowSelected : {}) }}
                onClick={() => toggleOrder(o.id)}
              >
                <input type="checkbox" readOnly checked={selected} style={{ pointerEvents: 'none' }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.title || 'Untitled'}
                  <span style={{ color: '#7A817A' }}>
                    {' · '}{o.order_type === 'cart' ? 'cart' : o.order_type === 'print_gallery' ? 'gallery' : 'own design'}
                  </span>
                </span>
                {o.width_inches && o.height_inches && (
                  <span style={{ fontSize: 11, color: '#7A817A', whiteSpace: 'nowrap' }}>
                    {o.width_inches.toFixed(1)}″ × {o.height_inches.toFixed(1)}″
                  </span>
                )}
                {o.pdf_generated_at && (
                  <span
                    title={`PDF generated ${new Date(o.pdf_generated_at).toLocaleString()}`}
                    style={{ fontSize: 10, fontWeight: 700, color: '#8a6d1f', background: '#f7efd8', border: '1px solid #e8d9a8', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}
                  >
                    PDF sent
                  </span>
                )}
                {o.created_at && (
                  <span style={{ fontSize: 11, color: '#9a9287', whiteSpace: 'nowrap' }}>
                    {new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
                {selected && <span style={styles.selectedBadge}>#{idx + 1}</span>}
                <button
                  type="button"
                  title="Printed and good — clear from the queue"
                  aria-label={`Mark ${o.title || 'order'} printed`}
                  disabled={orderBusyId === o.id}
                  onClick={(e) => { e.stopPropagation(); void confirmPrinted(o.id) }}
                  style={{
                    border: '1px solid #b6ccb0', background: '#eef4ec', color: '#3f6b38',
                    borderRadius: 6, width: 26, height: 26, lineHeight: 1, padding: 0,
                    cursor: orderBusyId === o.id ? 'default' : 'pointer', fontSize: 14, flexShrink: 0,
                    opacity: orderBusyId === o.id ? 0.5 : 1,
                  }}
                >
                  ✓
                </button>
              </div>
            )
          })}
          {orders.length === 0 && (
            <div style={{ fontSize: 12, color: '#7A817A', padding: '8px 0' }}>
              {ordersError || 'No orders waiting to print.'}
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: '#2D332F', marginBottom: 8 }}>
          Your finalized designs
        </div>
        <div style={styles.projectList}>
          {projects.filter(p => p.finalized && p.cells).map(p => {
            const selected = selectedIds.includes(p.id)
            const idx = selectedIds.indexOf(p.id)
            return (
              <div
                key={p.id}
                style={{ ...styles.projectRow, ...(selected ? styles.projectRowSelected : {}) }}
                onClick={() => toggleProject(p.id)}
              >
                <input type="checkbox" readOnly checked={selected} style={{ pointerEvents: 'none' }} />
                <span style={{ flex: 1 }}>{p.name || 'Untitled'}</span>
                {(() => {
                  // What will actually print, not the workspace the design was
                  // drawn on — roll print crops to content, so a sliver on a
                  // big blank canvas prints at its own size, not the canvas's.
                  const d = contentDimensionsInches(p.cells, p.mesh_count ?? 13)
                  if (!d) return null
                  const canvas = getCanvasForDesign(d.w, d.h)
                  return (
                    <span style={{ fontSize: 11, color: '#7A817A' }}>
                      {d.w.toFixed(1)}″ × {d.h.toFixed(1)}″ · {canvas.label} canvas
                    </span>
                  )
                })()}
                {selected && <span style={styles.selectedBadge}>#{idx + 1}</span>}
              </div>
            )
          })}
          {projects.filter(p => p.finalized && p.cells).length === 0 && (
            <div style={{ fontSize: 12, color: '#7A817A', padding: '8px 0' }}>
              No finalized projects found.
            </div>
          )}
        </div>

        <div style={styles.copiesRow}>
          <label htmlFor="copies">Copies of each design:</label>
          <input
            id="copies"
            type="number"
            min={1}
            max={20}
            value={copies}
            onChange={e => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
            style={styles.copiesInput}
          />
        </div>
        <div style={styles.copiesRow}>
          <label htmlFor="rollWidth">Roll width (inches):</label>
          <input
            id="rollWidth"
            type="number"
            min={4}
            max={MAX_ROLL_WIDTH_INCHES}
            step={0.5}
            value={rollWidthInches}
            onChange={e => setRollWidthInches(parseFloat(e.target.value) || MAX_ROLL_WIDTH_INCHES)}
            style={styles.copiesInput}
          />
        </div>
        <div style={styles.copiesRow}>
          <label htmlFor="gap">Gap between copies (inches):</label>
          <input
            id="gap"
            type="number"
            min={0}
            max={6}
            step={0.25}
            value={gapInches}
            onChange={e => setGapInches(Math.max(0, parseFloat(e.target.value) || 0))}
            style={styles.copiesInput}
          />
        </div>
        <div style={styles.copiesRow}>
          <label htmlFor="sideMargin">Side margin (inches):</label>
          <input
            id="sideMargin"
            type="number"
            min={0}
            max={4}
            step={0.25}
            placeholder="auto"
            value={sideMarginInches}
            onChange={e => setSideMarginInches(e.target.value)}
            style={styles.copiesInput}
          />
          <span style={{ fontSize: 11, color: '#7A817A' }}>
            blank = match top/bottom · 0 = image stops at the design
          </span>
        </div>
        <div style={styles.copiesRow}>
          <label htmlFor="logoX">Logo X offset (inches):</label>
          <input
            id="logoX"
            type="number"
            min={-2}
            max={2}
            step={0.05}
            value={logoXOffsetInches}
            onChange={e => setLogoXOffsetInches(parseFloat(e.target.value) || 0)}
            style={styles.copiesInput}
          />
        </div>
        <div style={styles.copiesRow}>
          <label htmlFor="logoY">Logo Y offset (inches):</label>
          <input
            id="logoY"
            type="number"
            min={-2}
            max={2}
            step={0.05}
            value={logoYOffsetInches}
            onChange={e => setLogoYOffsetInches(parseFloat(e.target.value) || 0)}
            style={styles.copiesInput}
          />
        </div>
        <div style={styles.copiesRow}>
          <label htmlFor="xOffset">X offset (inches):</label>
          <input
            id="xOffset"
            type="number"
            step={0.0278}
            value={xOffsetInches}
            onChange={e => setXOffsetInches(parseFloat(e.target.value) || 0)}
            style={styles.copiesInput}
          />
        </div>
        <div style={styles.copiesRow}>
          <label htmlFor="skewCorrection">Skew correction (inches):</label>
          <input
            id="skewCorrection"
            type="number"
            step={0.05}
            value={skewCorrectionInches}
            onChange={e => setSkewCorrectionInches(parseFloat(e.target.value) || 0)}
            style={styles.copiesInput}
          />
        </div>
        <div style={styles.copiesRow}>
          <label htmlFor="yScale">Length scale (1.0 = no stretch):</label>
          <input
            id="yScale"
            type="number"
            step={0.001}
            min={0.9}
            max={1.1}
            value={yScale}
            onChange={e => setYScale(parseFloat(e.target.value) || 1.0)}
            style={styles.copiesInput}
          />
        </div>

        <div style={styles.copiesRow}>
          <label htmlFor="includeAlignmentTest" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              id="includeAlignmentTest"
              type="checkbox"
              checked={includeAlignmentTest}
              onChange={e => setIncludeAlignmentTest(e.target.checked)}
            />
            Include alignment test strip (&quot;TEST&quot;, 18 mesh, 3&quot; wide, 1&quot; tall)
          </label>
        </div>

        {orderedDesigns && (
          <div style={styles.orderNote}>{orderedDesigns}</div>
        )}

        <div style={{ marginTop: 16 }}>
          <button
            style={{
              ...styles.btn,
              ...((rollBusy || (selectedCount === 0 && !includeAlignmentTest)) ? styles.btnDisabled : {}),
            }}
            onClick={handleRollPrint}
            disabled={rollBusy || (selectedCount === 0 && !includeAlignmentTest)}
          >
            {rollBusy ? 'Generating…' : 'Download Roll Print PDF'}
          </button>
        </div>
        {rollError && <div style={styles.error}>{rollError}</div>}
        {calibrationNote && (
          <div style={{ marginTop: 12, fontSize: 11, color: '#5a7a52' }}>{calibrationNote}</div>
        )}
      </div>

      {/* Finished work stays on screen. A retired order you cannot look up is
          indistinguishable from one that never existed. */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Completed Orders</div>
        <div style={styles.sectionDesc}>
          Orders you have confirmed as printed. If one turns out badly after the fact, send it back
          to the queue and print it again.
        </div>
        <div style={{ ...styles.projectList, marginBottom: 0 }}>
          {completed.map(o => (
            <div key={o.id} style={{ ...styles.projectRow, cursor: 'default' }}>
              <span style={{ color: '#5a7a52', flexShrink: 0 }}>✓</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {o.title || 'Untitled'}
                <span style={{ color: '#7A817A' }}>
                  {' · '}{o.order_type === 'cart' ? 'cart' : o.order_type === 'print_gallery' ? 'gallery' : 'own design'}
                </span>
              </span>
              {o.width_inches && o.height_inches && (
                <span style={{ fontSize: 11, color: '#7A817A', whiteSpace: 'nowrap' }}>
                  {o.width_inches.toFixed(1)}″ × {o.height_inches.toFixed(1)}″
                </span>
              )}
              {o.printed_at && (
                <span style={{ fontSize: 11, color: '#9a9287', whiteSpace: 'nowrap' }}>
                  {new Date(o.printed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
              <button
                type="button"
                title="Send back to the print queue"
                disabled={orderBusyId === o.id}
                onClick={() => void reopenOrder(o.id)}
                style={{
                  ...styles.btnSecondary, padding: '3px 10px', fontSize: 11, flexShrink: 0,
                  opacity: orderBusyId === o.id ? 0.5 : 1,
                }}
              >
                Print again
              </button>
            </div>
          ))}
          {completed.length === 0 && (
            <div style={{ fontSize: 12, color: '#7A817A', padding: '8px 0' }}>
              Nothing printed yet.
            </div>
          )}
        </div>
      </div>

      {/* Print log */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Recent Print Runs</div>
        <div style={styles.sectionDesc}>
          What was actually printed and with which settings. Mark each attempt ✓ or ✕ once you
          see the canvas — it usually takes a few PDFs to get one right, and an unjudged log
          can&rsquo;t tell you which settings to trust. Page length is recorded because every
          scale and skew value is relative to it — a 0.3″ skew means nothing without knowing
          it spanned 18″.
        </div>
        <div style={{ ...styles.projectList, marginBottom: 0 }}>
          {runs.map(r => (
            <div
              key={r.id}
              style={{
                ...styles.projectRow, alignItems: 'flex-start', flexDirection: 'column', gap: 4, cursor: 'default',
                // A known-good run should be findable at a glance in a list
                // where most rows are failed attempts.
                ...(r.outcome === 'good' ? { background: '#eef4ec', borderColor: '#b6ccb0' } : {}),
                ...(r.outcome === 'bad' ? { opacity: 0.55 } : {}),
              }}
            >
              <div style={{ display: 'flex', gap: 10, width: '100%', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 12 }}>
                  {new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </strong>
                {r.outcome === 'good' && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#3f6b38', background: '#dcebd7', border: '1px solid #b6ccb0', borderRadius: 4, padding: '2px 6px' }}>
                    GOOD PRINT
                  </span>
                )}
                {r.outcome === 'bad' && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#8c3a2e', background: '#f6e0dc', border: '1px solid #e0b8b0', borderRadius: 4, padding: '2px 6px' }}>
                    FAILED
                  </span>
                )}
                <span style={{ fontSize: 12, color: '#2D332F' }}>
                  {r.roll_width_inches ?? '?'}″ roll · {r.page_length_inches ?? '?'}″ page
                  {r.copies && r.copies > 1 ? ` · ×${r.copies}` : ''}
                </span>
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
                  <button
                    type="button"
                    title={r.outcome === 'good' ? 'Clear this verdict' : 'This one printed correctly'}
                    disabled={runBusyId === r.id}
                    onClick={() => void judgeRun(r, r.outcome === 'good' ? null : 'good')}
                    style={{
                      border: '1px solid #b6ccb0', borderRadius: 6, width: 26, height: 26, padding: 0, lineHeight: 1,
                      fontSize: 13, cursor: 'pointer', flexShrink: 0,
                      background: r.outcome === 'good' ? '#3f6b38' : '#eef4ec',
                      color: r.outcome === 'good' ? '#fff' : '#3f6b38',
                    }}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    title={r.outcome === 'bad' ? 'Clear this verdict' : 'This one did not print correctly'}
                    disabled={runBusyId === r.id}
                    onClick={() => void judgeRun(r, r.outcome === 'bad' ? null : 'bad')}
                    style={{
                      border: '1px solid #e0b8b0', borderRadius: 6, width: 26, height: 26, padding: 0, lineHeight: 1,
                      fontSize: 13, cursor: 'pointer', flexShrink: 0,
                      background: r.outcome === 'bad' ? '#8c3a2e' : '#f9eeec',
                      color: r.outcome === 'bad' ? '#fff' : '#8c3a2e',
                    }}
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    onClick={() => reuseRun(r)}
                    style={{ ...styles.btnSecondary, padding: '3px 10px', fontSize: 11 }}
                  >
                    Reuse settings
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#7A817A' }}>
                Y {r.y_scale ?? 1} · X {r.x_offset_inches ?? 0}″ · skew {r.skew_correction_inches ?? 0}″
                {' · '}side {r.side_margin_inches == null ? 'auto' : `${r.side_margin_inches}″`}
                {' · '}gap {r.gap_inches ?? 0}″
                {(r.logo_x_offset_inches || r.logo_y_offset_inches)
                  ? ` · logo ${r.logo_x_offset_inches ?? 0}/${r.logo_y_offset_inches ?? 0}″` : ''}
              </div>
              {r.designs && r.designs.length > 0 && (
                <div style={{ fontSize: 11, color: '#9a9287' }}>
                  {r.designs.map((d, i) => (
                    <span key={i}>
                      {i > 0 ? ' · ' : ''}
                      {d.label || 'Untitled'} {d.printed_w_in}×{d.printed_h_in}″ @{d.mesh}
                      {d.rotated ? ' (rotated)' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {runs.length === 0 && (
            <div style={{ fontSize: 12, color: '#7A817A', padding: '8px 0' }}>
              No print runs logged yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
