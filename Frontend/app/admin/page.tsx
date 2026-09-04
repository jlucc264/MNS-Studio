'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { adminListGallery, adminSuspendGalleryItem, adminRestoreGalleryItem, type AdminGalleryItem } from '../../lib/api'
import {
  listProjects,
  downloadBlankRollPdf,
  downloadCalibrationPdf,
  downloadRegistrationTestPdf,
  downloadRollPrintPdf,
  downloadTestLinePdf,
  type TestLineColor,
  MAX_ROLL_WIDTH_INCHES,
  contentDimensionsInches,
  getCanvasForDesign,
  deletePrintRun,
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
    marginBottom: 8,
  } as const,
  spendLink: {
    fontSize: 12,
    color: '#5c7856',
    marginBottom: 32,
    display: 'inline-block',
    textDecoration: 'none',
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
  calcBox: {
    border: '1px dashed #D7D0C8',
    borderRadius: 8,
    padding: '14px 16px',
    marginBottom: 16,
    background: '#FAFAF8',
  } as const,
  calcResult: {
    marginTop: 10,
    fontSize: 12,
    color: '#2D332F',
  } as const,
}

// Calibration is per-machine and admin-only, so it lives in the browser rather
// than costing a Supabase table. Keyed by roll width as a string.
type Calibration = { yScale: number; xOffsetInches: number; skewCorrectionInches: number; skewCorrectionYInches: number }
const CALIBRATION_KEY = 'mns_roll_calibration_v1'

function loadCalibration(): Record<string, Calibration> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(CALIBRATION_KEY) ?? '{}') as Record<string, Calibration>
  } catch {
    return {}
  }
}

/** Returns whether the save actually succeeded — private browsing and a full
 *  localStorage quota (e.g. from the studio's own autosaved design recovery
 *  snapshot) both fail silently otherwise, and the operator has no way to
 *  know their calibration didn't stick. */
function saveCalibration(rollWidth: number, values: Calibration): boolean {
  if (typeof window === 'undefined') return false
  try {
    const all = loadCalibration()
    all[String(rollWidth)] = values
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

// Confirmed scales, keyed by "<roll width>-<mesh>". Mesh is part of the key
// deliberately — 13-mesh canvas feeds differently from 18-mesh (different
// physical fabric), so a value confirmed for one mesh says nothing about the
// other.
//
// IMPORTANT — two different targets live in this table, and they are not
// interchangeable. Length-accurate ("the print measures 15in with a ruler")
// and stitch-accurate ("the print spans exactly 195 real canvas holes") only
// coincide if the canvas has exactly <mesh> holes per inch. It does not. The
// two targets differ by nominal_mesh / real_holes_per_inch, which measured
// ~2% on 13-mesh stock. A value tuned by ruler is therefore WRONG for stitch
// alignment by that factor, which is what stitchers actually notice — they
// follow holes, not printed marks.
//
// All values below are STITCH-calibrated (2026-08-31) except where noted,
// measured with the tick mode of generate_test_line_pdf: print at a known
// scale, count canvas holes to each labelled tick, correct by expected /
// counted. Two independent sheet lengths per width, and a confirmation sheet
// at the resulting value for anything that came out materially off 1.000.
//
//   8-13  = 1.021  At 1.000 it ran 4 stitches short over 15in (191 of 195).
//                  Confirmed: a 15in sheet at 1.021 read exactly 195. Error
//                  was uniform per segment, not front-loaded, which is why
//                  this is a flat constant and not a length curve.
//   10-13 = 1.000  Read 196 of 195 over 15in (+1). Supersedes the old
//   12-13 = 1.000  Read 193.5 of 195 (-1.5).      0.9846, which was
//   16-13 = 1.000  Read exactly 195.              length-derived.
//
//   8-18  = 1.021  Read 123.5 of 126 on a 7in sheet and 70.5 of 72 on a 4in,
//                  implying 1.020 and 1.021.
//   10-18 = 0.992  Read 127 of 126 and 72.6 of 72 — both ~0.8% long, giving
//                  ~18.145 holes per commanded inch. Supersedes 89/90
//                  (0.9889), which was length-derived and slightly
//                  over-corrected: it encoded "1 stitch of drift per 5in"
//                  where the measured rate is closer to 0.7.
//   12-18 = 1.000  Read exactly 72 of 72 on a 4in and 126 of 126 on a 7in.
//   16-18 = 1.000  NOT MEASURED — see PROVISIONAL_Y_SCALE_KEYS below.
//
// Two findings worth keeping. First, 8" needs the same 1.021 at BOTH mesh
// counts while 10" moved from 1.000 to 0.992 between them — so the 8" deficit
// is the printer losing ~2% of feed to poor grip on narrow stock, largely
// indifferent to the fabric, whereas the wider widths track the weave. Second,
// the wide widths all land within ~1.5 stitches over a full-length design
// (~0.1in), so they share one number rather than each carrying a per-width
// correction resting on a single sheet.
//
// Retired 2026-08-31: eightInchYScaleForLength, a least-squares fit over three
// short LENGTH measurements that gave 8" a 1/L curve climbing toward 1.0388.
// The stitch run disproved its shape at both mesh counts — the real
// per-segment shortfall is flat, and the curve called for 1.035 where the
// truth was 1.021. Both 8" pairs are now ordinary locked constants.
const CALIBRATED_Y_SCALES: Record<string, number> = {
  '8-13': 1.021,
  '10-13': 1.0,
  '12-13': 1.0,
  '16-13': 1.0,
  '8-18': 1.021,
  '10-18': 0.992,
  '12-18': 1.0,
  '16-18': 1.0,
}

// Entries defaulted to 1.000 without a stitch test behind them. They still
// lock the field (1.000 is the best guess given every other width at that mesh
// landed there) but the UI labels them provisional rather than confirmed —
// mislabelling an untested value as measured is exactly what sent the 13-mesh
// numbers wrong for a week.
const PROVISIONAL_Y_SCALE_KEYS = new Set(['16-18'])

// Distinct colors per mesh count (not just text) so a mismatched mesh jumps
// out while scanning a list of rows, rather than requiring you to read every
// number — that's the whole point of making this "more visible."
function MeshBadge({ meshCount }: { meshCount: number | null | undefined }) {
  const style = meshCount === 18
    ? { color: '#2c5a8a', background: '#e3edf7', border: '1px solid #b8cfe8' }
    : meshCount === 13
      ? { color: '#6a3a8a', background: '#f0e7f7', border: '1px solid #d3bce8' }
      : { color: '#7A817A', background: '#f0efec', border: '1px solid #d9d5cc' }
  return (
    <span style={{ ...style, fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>
      {meshCount ? `${meshCount} mesh` : 'mesh ?'}
    </span>
  )
}

export default function AdminPage() {
  const { session, loading } = useAuth()
  const router = useRouter()

  // Copyright review. Kept in this page rather than a separate route so the
  // operator reviewing listings is the same person already authenticated here.
  const [galleryItems, setGalleryItems] = useState<AdminGalleryItem[]>([])
  const [galleryError, setGalleryError] = useState('')
  const [galleryBusy, setGalleryBusy] = useState<string | null>(null)
  const [galleryNotice, setGalleryNotice] = useState('')
  const [reasonFor, setReasonFor] = useState<Record<string, string>>({})
  const [notifyOnHide, setNotifyOnHide] = useState(true)
  const [showSuspendedOnly, setShowSuspendedOnly] = useState(false)

  const [projects, setProjects] = useState<Project[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [orders, setOrders] = useState<PrintOrder[]>([])
  const [completed, setCompleted] = useState<PrintOrder[]>([])
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [ordersError, setOrdersError] = useState('')
  const [orderBusyId, setOrderBusyId] = useState('')
  const [runBusyId, setRunBusyId] = useState('')
  const [runs, setRuns] = useState<PrintRun[]>([])
  // Good runs are a durable calibration reference, not just recent-attempts
  // scrollback — fetch enough that an old good one doesn't fall off the list.
  const [showGoodRunsOnly, setShowGoodRunsOnly] = useState(false)
  const [copies, setCopies] = useState(1)
  const [rollWidthInches, setRollWidthInches] = useState(MAX_ROLL_WIDTH_INCHES)
  const [gapInches, setGapInches] = useState(0)
  // Empty string = match the top/bottom canvas margin (previous behaviour).
  const [sideMarginInches, setSideMarginInches] = useState('')
  const [logoXOffsetInches, setLogoXOffsetInches] = useState(0)
  const [logoYOffsetInches, setLogoYOffsetInches] = useState(0)
  const [xOffsetInches, setXOffsetInches] = useState(0)
  const [skewCorrectionInches, setSkewCorrectionInches] = useState(0)
  const [skewCorrectionYInches, setSkewCorrectionYInches] = useState(0)

  // Skew is a rate (drift per inch fed), not a fixed offset — a measurement
  // taken over one print length has to be rescaled before it means anything
  // for a job of a different length. See print_runs.page_length_inches: "a
  // 0.3in skew means nothing without knowing it spanned 18in."
  const [skewCalcAxis, setSkewCalcAxis] = useState<'feed' | 'width'>('feed')
  const [skewCalcMesh, setSkewCalcMesh] = useState(18)
  const [skewCalcPixels, setSkewCalcPixels] = useState('')
  const [skewCalcSpanInches, setSkewCalcSpanInches] = useState('')
  const [skewCalcTargetInches, setSkewCalcTargetInches] = useState('')
  const [yScale, setYScale] = useState(1.0)
  // A locked value only means something if every selected design shares one
  // mesh — mixing meshes in one job means at least one of them is printing
  // at the wrong scale no matter what's picked, so that case falls back to
  // manual rather than silently locking to a value that's only right for
  // some of the selection.
  const selectedMeshCounts = new Set<number>([
    ...orders.filter(o => selectedOrderIds.includes(o.id) && o.mesh_count != null).map(o => o.mesh_count as number),
    ...projects.filter(p => selectedIds.includes(p.id)).map(p => p.mesh_count ?? 13),
  ])
  const singleSelectedMesh = selectedMeshCounts.size === 1 ? Array.from(selectedMeshCounts)[0] : null
  const calibratedKey = `${rollWidthInches}-${singleSelectedMesh}`
  const calibratedYScale = singleSelectedMesh != null
    ? CALIBRATED_Y_SCALES[calibratedKey]
    : undefined
  const calibratedIsProvisional = calibratedYScale != null && PROVISIONAL_Y_SCALE_KEYS.has(calibratedKey)
  const [yScaleOverride, setYScaleOverride] = useState(false)
  const [includeAlignmentTest, setIncludeAlignmentTest] = useState(false)
  const [calibBusy, setCalibBusy] = useState(false)
  const [regBusy, setRegBusy] = useState(false)
  const [blankBusy, setBlankBusy] = useState(false)
  const [rollBusy, setRollBusy] = useState(false)
  const [testLineInches, setTestLineInches] = useState('')
  // Defaults to beige rather than gray — swappable so a calibration run
  // doesn't have to compete with real jobs for whichever cartridge is low.
  const [testLineColor, setTestLineColor] = useState<TestLineColor>('beige')
  // 0 = the original length-only line. Picking a mesh switches it to the
  // stitch-counting variant with labelled ticks.
  const [testLineMesh, setTestLineMesh] = useState(0)
  const [testLineBusy, setTestLineBusy] = useState(false)
  const [testLineError, setTestLineError] = useState('')
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
    listPrintRuns(session.access_token, 100).then(setRuns).catch(() => {})
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

  // Deleting is distinct from marking a run bad: a bad verdict stays visible
  // on purpose (a warning against reusing it), delete is for junk you never
  // want to see again. Native confirm since it's irreversible.
  async function deleteRun(r: PrintRun) {
    if (!session) return
    if (!window.confirm('Delete this print run permanently? This cannot be undone.')) return
    setRunBusyId(r.id)
    try {
      await deletePrintRun(r.id, session.access_token)
      refreshRuns()
    } catch {
      setRollError('Could not delete that run.')
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
    if (r.skew_correction_y_inches != null) setSkewCorrectionYInches(r.skew_correction_y_inches)
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
    // A calibrated width/mesh pair is locked unless explicitly overridden — a
    // stale saved value must not clobber it.
    if (!(calibratedYScale != null && !yScaleOverride)) setYScale(saved.yScale)
    setXOffsetInches(saved.xOffsetInches)
    setSkewCorrectionInches(saved.skewCorrectionInches)
    setSkewCorrectionYInches(saved.skewCorrectionYInches ?? 0)
    // yScale multiplies the entire print slot (design + margin), so a stale
    // value from a botched calibration pass silently turns into inches of
    // blank leader or a stretched print — surface the actual numbers instead
    // of a bare "loaded" message, and flag it if yScale looks out of range.
    const yScaleLooksOff = saved.yScale < 0.9 || saved.yScale > 1.1
    setCalibrationNote(
      `Loaded saved calibration for ${rollWidthInches}″ roll: `
      + `length scale ${saved.yScale}, x offset ${saved.xOffsetInches}″, `
      + `skew ${saved.skewCorrectionInches}″, skew Y ${saved.skewCorrectionYInches ?? 0}″.`
      + (yScaleLooksOff ? ' ⚠ Length scale is outside the normal 0.9–1.1 range — check before printing.' : '')
    )
  }, [rollWidthInches])

  // A calibrated width/mesh pair (see CALIBRATED_Y_SCALES) locks to its
  // confirmed value unless the operator explicitly opts into overriding it for
  // testing. Anything with no entry falls through to the manual field.
  useEffect(() => {
    if (calibratedYScale != null && !yScaleOverride) {
      setYScale(calibratedYScale)
    }
  }, [rollWidthInches, calibratedYScale, yScaleOverride])

  // Selection changed to a mix of meshes, a different width, or an
  // uncalibrated mesh — don't leave a stale override switched on for next
  // time this same combination becomes locked again.
  useEffect(() => {
    if (calibratedYScale == null) setYScaleOverride(false)
  }, [calibratedYScale])

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

  async function handleTestLine() {
    if (!session) return
    const length = parseFloat(testLineInches)
    if (!length || length <= 0) return
    setTestLineBusy(true)
    setTestLineError('')
    try {
      await downloadTestLinePdf(session.access_token, length, rollWidthInches, yScale, testLineColor, testLineMesh)
    } catch (e: unknown) {
      setTestLineError(e instanceof Error ? e.message : 'Error')
    } finally {
      setTestLineBusy(false)
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
        skewCorrectionYInches,
        yScale,
        includeAlignmentTest,
      })
      // Only persist once a print actually generated — a width whose values
      // errored out isn't a calibration worth remembering.
      const saved = saveCalibration(rollWidthInches, { yScale, xOffsetInches, skewCorrectionInches, skewCorrectionYInches })
      setCalibrationNote(
        saved
          ? `Saved calibration for ${rollWidthInches}″ roll.`
          : `⚠ Could not save calibration for ${rollWidthInches}″ roll — browser storage is full or unavailable `
            + `(the print itself still worked). Free up localStorage — Application → Local Storage in DevTools — `
            + `and try again, or the great settings you just found won't be there next visit.`
      )
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

  useEffect(() => {
    if (!session?.access_token) return
    adminListGallery(session.access_token).then(setGalleryItems).catch(() => {
      setGalleryError('Could not load gallery listings.')
    })
  }, [session?.access_token])

  async function refreshGallery() {
    if (!session?.access_token) return
    try {
      setGalleryItems(await adminListGallery(session.access_token))
    } catch {
      setGalleryError('Could not reload gallery listings.')
    }
  }

  async function handleHide(item: AdminGalleryItem) {
    if (!session?.access_token) return
    setGalleryBusy(item.id)
    setGalleryError('')
    setGalleryNotice('')
    try {
      const result = await adminSuspendGalleryItem(
        item.id, reasonFor[item.id] || '', notifyOnHide, session.access_token,
      )
      // The hide always applied; only the email is uncertain. Say which
      // happened rather than implying the whole action failed.
      setGalleryNotice(
        result.notify_error
          ? `Listing hidden. Creator NOT notified — ${result.notify_error}`
          : result.notified
            ? 'Listing hidden and the creator was notified.'
            : 'Listing hidden. No notification was sent.',
      )
      await refreshGallery()
    } catch {
      setGalleryError('Could not hide this listing.')
    } finally {
      setGalleryBusy(null)
    }
  }

  async function handleRestore(item: AdminGalleryItem) {
    if (!session?.access_token) return
    setGalleryBusy(item.id)
    setGalleryError('')
    setGalleryNotice('')
    try {
      await adminRestoreGalleryItem(item.id, session.access_token)
      setGalleryNotice('Listing restored.')
      await refreshGallery()
    } catch {
      setGalleryError('Could not restore this listing.')
    } finally {
      setGalleryBusy(null)
    }
  }

  const visibleGalleryItems = showSuspendedOnly
    ? galleryItems.filter((i) => i.suspended_at)
    : galleryItems
  const suspendedCount = galleryItems.filter((i) => i.suspended_at).length

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Roll Print Admin</h1>
      <p style={styles.subtitle}>P900 · 18 mesh · up to {MAX_ROLL_WIDTH_INCHES}″ roll · admin only</p>
      <a href="/admin/spend" style={styles.spendLink}>Spend Management &rarr;</a>

      {/* Copyright review */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Gallery — copyright review</div>
        <div style={styles.sectionDesc}>
          Hiding is never a delete. The row is kept as evidence under the litigation hold and is
          what the strike count in Terms 4.5 is derived from. A hidden listing disappears from the
          feed, its creator&rsquo;s profile, and direct links — but orders already paid for still print.
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: '#5B635C', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={notifyOnHide} onChange={(e) => setNotifyOnHide(e.target.checked)} />
            Email the creator when hiding
          </label>
          <label style={{ fontSize: 12, color: '#5B635C', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showSuspendedOnly} onChange={(e) => setShowSuspendedOnly(e.target.checked)} />
            Show hidden only
          </label>
          <span style={{ fontSize: 12, color: '#7A817A' }}>
            {galleryItems.length} listings · {suspendedCount} hidden
          </span>
        </div>

        {galleryError && <div style={{ fontSize: 12, color: '#b0453a', marginBottom: 10 }}>{galleryError}</div>}
        {galleryNotice && <div style={{ fontSize: 12, color: '#5c7856', marginBottom: 10 }}>{galleryNotice}</div>}

        {visibleGalleryItems.length === 0 && (
          <div style={{ fontSize: 12, color: '#7A817A' }}>No listings to show.</div>
        )}

        {visibleGalleryItems.map((item) => {
          const hidden = Boolean(item.suspended_at)
          return (
            <div
              key={item.id}
              style={{
                border: '1px solid #E8E4DC',
                borderLeft: hidden ? '3px solid #b0453a' : '3px solid #E8E4DC',
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 10,
                background: hidden ? '#fdf7f6' : '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#2D332F' }}>
                    {item.title || '(untitled)'}
                    {hidden && <span style={{ marginLeft: 8, fontSize: 11, color: '#b0453a' }}>HIDDEN</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#7A817A', marginTop: 3 }}>
                    {item.submitter_name || 'unknown creator'}
                    {typeof item.creator_suspension_count === 'number' && item.creator_suspension_count > 0 && (
                      <span style={{ color: '#b0453a' }}>
                        {' '}· {item.creator_suspension_count} hidden on this account
                      </span>
                    )}
                    {item.tags && item.tags.length > 0 && <span> · {item.tags.join(', ')}</span>}
                  </div>
                  {hidden && item.suspended_reason && (
                    <div style={{ fontSize: 11, color: '#8a5a28', marginTop: 4 }}>
                      Reference: {item.suspended_reason}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  {!hidden && (
                    <input
                      value={reasonFor[item.id] || ''}
                      onChange={(e) => setReasonFor((r) => ({ ...r, [item.id]: e.target.value }))}
                      placeholder="Reference (e.g. Corsearch notice 2026-08-31)"
                      style={{
                        fontFamily: 'inherit', fontSize: 12, padding: '7px 9px',
                        border: '1px solid #d7d0c8', borderRadius: 6, minWidth: 230,
                      }}
                    />
                  )}
                  <button
                    type="button"
                    disabled={galleryBusy === item.id}
                    onClick={() => (hidden ? handleRestore(item) : handleHide(item))}
                    style={{
                      ...styles.btn,
                      borderColor: hidden ? '#5c7856' : '#b0453a',
                      color: hidden ? '#5c7856' : '#b0453a',
                      cursor: galleryBusy === item.id ? 'default' : 'pointer',
                      opacity: galleryBusy === item.id ? 0.5 : 1,
                    }}
                  >
                    {galleryBusy === item.id ? '…' : hidden ? 'Restore' : 'Hide'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

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
                {/* The buyer bought a narrower border to drop a roll tier, so
                    this order goes on narrower stock than its size implies.
                    Loading the standard width would waste the saving and print
                    a border the buyer did not pay for. */}
                {o.tier_downgrade && (
                  <span
                    title={
                      o.canvas_margin_inches
                        ? `Buyer chose a ${o.canvas_margin_inches}″ border instead of 2″ — load the narrower roll`
                        : 'Buyer chose a narrower border to drop a roll tier'
                    }
                    style={{ fontSize: 10, fontWeight: 700, color: '#8a4a3f', background: '#f9ece9', border: '1px solid #e8c9c2', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}
                  >
                    {o.canvas_margin_inches ? `${o.canvas_margin_inches}″ border` : 'trimmed border'}
                  </span>
                )}
                <MeshBadge meshCount={o.mesh_count} />
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
                <MeshBadge meshCount={p.mesh_count ?? 13} />
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
        <div style={styles.calcBox}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#2D332F', marginBottom: 8 }}>
            Skew Calculator
          </div>
          <div style={{ fontSize: 11, color: '#7A817A', marginBottom: 10, lineHeight: 1.5 }}>
            Count the drift in stitches (pixels) on the physical print rather than measuring fractions of an
            inch with a ruler. Fill in the target length only if this job&rsquo;s page length differs from what
            you measured — skew scales with length, so the same drift means a different correction on a
            longer or shorter print.
          </div>
          <div style={styles.copiesRow}>
            <label htmlFor="skewCalcAxis">Correcting:</label>
            <select
              id="skewCalcAxis"
              value={skewCalcAxis}
              onChange={e => setSkewCalcAxis(e.target.value as 'feed' | 'width')}
              style={styles.copiesInput}
            >
              <option value="feed">Feed skew (down the length)</option>
              <option value="width">Width skew (across the roll)</option>
            </select>
          </div>
          <div style={styles.copiesRow}>
            <label htmlFor="skewCalcMesh">Mesh count:</label>
            <input
              id="skewCalcMesh"
              type="number"
              min={1}
              step={1}
              value={skewCalcMesh}
              onChange={e => setSkewCalcMesh(parseInt(e.target.value) || 1)}
              style={styles.copiesInput}
            />
          </div>
          <div style={styles.copiesRow}>
            <label htmlFor="skewCalcPixels">Drift observed (stitches):</label>
            <input
              id="skewCalcPixels"
              type="number"
              step={0.5}
              value={skewCalcPixels}
              onChange={e => setSkewCalcPixels(e.target.value)}
              style={styles.copiesInput}
            />
          </div>
          <div style={styles.copiesRow}>
            <label htmlFor="skewCalcSpan">Measured across (inches):</label>
            <input
              id="skewCalcSpan"
              type="number"
              step={0.5}
              value={skewCalcSpanInches}
              onChange={e => setSkewCalcSpanInches(e.target.value)}
              style={styles.copiesInput}
            />
          </div>
          <div style={styles.copiesRow}>
            <label htmlFor="skewCalcTarget">Target length (inches, optional):</label>
            <input
              id="skewCalcTarget"
              type="number"
              step={0.5}
              placeholder="same as above"
              value={skewCalcTargetInches}
              onChange={e => setSkewCalcTargetInches(e.target.value)}
              style={styles.copiesInput}
            />
          </div>
          {(() => {
            const pixels = parseFloat(skewCalcPixels)
            const span = parseFloat(skewCalcSpanInches)
            const target = skewCalcTargetInches === '' ? span : parseFloat(skewCalcTargetInches)
            if (!Number.isFinite(pixels) || !Number.isFinite(span) || span <= 0 || !skewCalcMesh) return null
            const rawInches = pixels / skewCalcMesh
            const scaledInches = Number.isFinite(target) && target > 0 ? rawInches * (target / span) : rawInches
            return (
              <>
                <div style={styles.calcResult}>
                  = <strong>{scaledInches.toFixed(4)}″</strong>
                  {target !== span && Number.isFinite(target) && (
                    <span style={{ color: '#7A817A' }}>
                      {' '}({rawInches.toFixed(4)}″ measured over {span}″, scaled to {target}″)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  style={{ ...styles.btnSecondary, marginTop: 10 }}
                  onClick={() => {
                    if (skewCalcAxis === 'feed') setSkewCorrectionInches(scaledInches)
                    else setSkewCorrectionYInches(scaledInches)
                  }}
                >
                  Use as {skewCalcAxis === 'feed' ? 'feed' : 'width'} skew correction
                </button>
              </>
            )
          })()}
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
          <label htmlFor="skewCorrectionY">Skew correction — across width (inches):</label>
          <input
            id="skewCorrectionY"
            type="number"
            step={0.05}
            value={skewCorrectionYInches}
            onChange={e => setSkewCorrectionYInches(parseFloat(e.target.value) || 0)}
            style={styles.copiesInput}
          />
        </div>
        {calibratedYScale != null && !yScaleOverride ? (
          <div style={styles.copiesRow}>
            <label>Length scale (1.0 = no stretch):</label>
            <span style={{
              ...styles.copiesInput,
              display: 'inline-flex',
              alignItems: 'center',
              fontWeight: 700,
              ...(calibratedIsProvisional
                ? { background: '#FBF4E4', color: '#8a6d1f', border: '1px solid #e0cfa4' }
                : { background: '#F0F4EF', color: '#3f6b38', border: '1px solid #b6ccb0' }),
            }}>
              {calibratedYScale.toFixed(3)}
            </span>
            <span style={{ fontSize: 11, color: calibratedIsProvisional ? '#8a6d1f' : '#7A817A' }}>
              {calibratedIsProvisional
                ? `provisional — defaulted for ${rollWidthInches}″ roll, ${singleSelectedMesh} mesh, not yet stitch-tested`
                : `locked — confirmed for ${rollWidthInches}″ roll, ${singleSelectedMesh} mesh`}
            </span>
            <button
              type="button"
              style={{ ...styles.btnSecondary, padding: '4px 10px', fontSize: 11 }}
              onClick={() => setYScaleOverride(true)}
            >
              Override
            </button>
          </div>
        ) : (
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
            {calibratedYScale != null && (
              <button
                type="button"
                style={{ ...styles.btnSecondary, padding: '4px 10px', fontSize: 11 }}
                onClick={() => setYScaleOverride(false)}
              >
                Re-lock to {calibratedYScale.toFixed(3)}
              </button>
            )}
          </div>
        )}
        {selectedMeshCounts.size > 1 && (
          <div style={{ fontSize: 11, color: '#8a6d1f', marginTop: -4, marginBottom: 12 }}>
            ⚠ Selection mixes mesh counts ({Array.from(selectedMeshCounts).sort().join(', ')}) — no single length scale is
            correct for all of them. Printing them in separate batches is the only way to get each one right.
          </div>
        )}

        <div style={styles.calcBox}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#2D332F', marginBottom: 8 }}>
            Test Line
          </div>
          <div style={{ fontSize: 11, color: '#7A817A', marginBottom: 10, lineHeight: 1.5 }}>
            Generates one continuous line, two stitch widths thick, exactly this length tall,
            with the same 2&Prime;-per-side blank margin a real design gets before the length scale is
            applied to the whole thing — a real design&rsquo;s total commanded feed distance is
            (content + 4&Prime;) &times; scale, not just content &times; scale. Uses the roll width and
            length scale set above.
          </div>
          <div style={{ fontSize: 11, color: '#7A817A', marginBottom: 10, lineHeight: 1.5 }}>
            <strong>Length mode</strong> (mesh = off): measure the line itself with a ruler, not the blank
            margin above/below it. <strong>Stitch mode</strong> (pick a mesh): adds labelled cross-ticks
            every 5 nominal inches — count canvas <em>holes</em> from the top tick to each label. If the
            tick marked &ldquo;195 st&rdquo; sits over hole 192, the correction is
            scale &times; (195 / 192), using the scale this sheet was printed at.
          </div>
          <div style={styles.copiesRow}>
            <label htmlFor="testLineInches">Test length (inches):</label>
            <input
              id="testLineInches"
              type="number"
              step={0.1}
              min={0.1}
              value={testLineInches}
              onChange={e => setTestLineInches(e.target.value)}
              style={styles.copiesInput}
            />
          </div>
          <div style={styles.copiesRow}>
            <label htmlFor="testLineMesh">Mesh (ticks):</label>
            <select
              id="testLineMesh"
              value={testLineMesh}
              onChange={e => setTestLineMesh(Number(e.target.value))}
              style={styles.copiesInput}
            >
              <option value={0}>Off — length only</option>
              <option value={13}>13 mesh</option>
              <option value={18}>18 mesh</option>
            </select>
            {testLineMesh > 0 && parseFloat(testLineInches) > 0 && (
              <span style={{ fontSize: 11, color: '#7A817A' }}>
                → {Math.round(parseFloat(testLineInches) * testLineMesh)} stitches, tick every {testLineMesh * 5}
              </span>
            )}
          </div>
          <div style={styles.copiesRow}>
            <label htmlFor="testLineColor">Ink color:</label>
            <select
              id="testLineColor"
              value={testLineColor}
              onChange={e => setTestLineColor(e.target.value as TestLineColor)}
              style={styles.copiesInput}
            >
              <option value="gray">Gray</option>
              <option value="beige">Beige</option>
              <option value="yellow">Yellow</option>
              <option value="pink">Light pink</option>
            </select>
          </div>
          <button
            style={{ ...styles.btnSecondary, ...((testLineBusy || !testLineInches) ? styles.btnDisabled : {}) }}
            disabled={testLineBusy || !testLineInches}
            onClick={handleTestLine}
          >
            {testLineBusy ? 'Generating…' : 'Download Test Line PDF'}
          </button>
          {testLineError && <div style={styles.error}>{testLineError}</div>}
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
          <div style={{ marginTop: 12, fontSize: 11, color: calibrationNote.includes('⚠') ? '#B03A2E' : '#5a7a52' }}>
            {calibrationNote}
          </div>
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
              {/* Still relevant after printing: a reopened order has to go
                  back onto the same narrower stock it was sold against. */}
              {o.tier_downgrade && (
                <span
                  title={
                    o.canvas_margin_inches
                      ? `Buyer chose a ${o.canvas_margin_inches}″ border instead of 2″ — load the narrower roll`
                      : 'Buyer chose a narrower border to drop a roll tier'
                  }
                  style={{ fontSize: 10, fontWeight: 700, color: '#8a4a3f', background: '#f9ece9', border: '1px solid #e8c9c2', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}
                >
                  {o.canvas_margin_inches ? `${o.canvas_margin_inches}″ border` : 'trimmed border'}
                </span>
              )}
              <MeshBadge meshCount={o.mesh_count} />
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={showGoodRunsOnly}
            onChange={e => setShowGoodRunsOnly(e.target.checked)}
          />
          Show good prints only (calibration reference)
        </label>
        <div style={{ ...styles.projectList, marginBottom: 0 }}>
          {runs.filter(r => !showGoodRunsOnly || r.outcome === 'good').map(r => (
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
                  <button
                    type="button"
                    title="Delete this run permanently"
                    disabled={runBusyId === r.id}
                    onClick={() => void deleteRun(r)}
                    style={{
                      border: '1px solid #ccc', borderRadius: 6, width: 26, height: 26, padding: 0, lineHeight: 1,
                      fontSize: 13, cursor: 'pointer', flexShrink: 0, background: '#f4f2ee', color: '#7A817A',
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#7A817A' }}>
                Y {r.y_scale ?? 1} · X {r.x_offset_inches ?? 0}″ · skew {r.skew_correction_inches ?? 0}″
                {' · '}skew Y {r.skew_correction_y_inches ?? 0}″
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
