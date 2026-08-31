'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import {
  createExpense,
  createExpenseTemplate,
  deleteExpense,
  deleteExpenseTemplate,
  getSpendSummary,
  listExpenseTemplates,
  listExpenses,
  listOrdersInRange,
  updateExpense,
  updateExpenseTemplate,
  type Expense,
  type ExpenseTemplate,
  type PrintOrder,
  type SpendSummary,
} from '../../../lib/api'

const styles = {
  page: {
    minHeight: '100vh',
    background: '#F7F5F0',
    fontFamily: 'Georgia, serif',
    padding: '48px 32px',
    maxWidth: 960,
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
  backLink: {
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
  btnSmall: {
    padding: '4px 10px',
    fontSize: 11,
  } as const,
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  } as const,
  iconBtn: {
    border: '1px solid #ccc', background: '#f4f2ee', color: '#7A817A',
    borderRadius: 6, width: 26, height: 26, lineHeight: 1, padding: 0,
    cursor: 'pointer', fontSize: 13, flexShrink: 0,
  } as const,
  list: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    marginBottom: 4,
  } as const,
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    border: '1px solid #E8E4DC',
    borderRadius: 8,
    background: '#FAFAF8',
    fontSize: 13,
    color: '#2D332F',
  } as const,
  input: {
    padding: '6px 10px',
    border: '1px solid #D7D0C8',
    borderRadius: 6,
    fontFamily: 'inherit',
    fontSize: 13,
    color: '#2D332F',
  } as const,
  formRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap' as const,
    marginBottom: 10,
  } as const,
  inlineForm: {
    border: '1px dashed #D7D0C8',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    marginBottom: 8,
    background: '#FCFBF9',
  } as const,
  tag: {
    fontSize: 10,
    fontWeight: 700,
    color: '#5a7a52',
    background: '#eef4ec',
    border: '1px solid #b6ccb0',
    borderRadius: 4,
    padding: '2px 6px',
    whiteSpace: 'nowrap' as const,
  } as const,
  error: {
    marginTop: 12,
    fontSize: 12,
    color: '#B03A2E',
  } as const,
  statRow: {
    display: 'flex',
    gap: 16,
    flexWrap: 'wrap' as const,
  } as const,
  statBox: {
    flex: '1 1 160px',
    border: '1px solid #E8E4DC',
    borderRadius: 8,
    padding: '14px 16px',
    background: '#FAFAF8',
  } as const,
  statLabel: {
    fontSize: 11,
    color: '#7A817A',
    marginBottom: 4,
  } as const,
  statValue: {
    fontSize: 22,
    fontWeight: 700,
    color: '#2D332F',
  } as const,
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function centsToStr(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2)
}

function dollarsToCents(s: string): number {
  return Math.round((parseFloat(s) || 0) * 100)
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type Range = { start?: string; end?: string; label: string }

function presetRanges(): Record<string, Range> {
  const now = new Date()
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  return {
    thisMonth: { start: toDateInput(startOfThisMonth), end: toDateInput(now), label: 'This Month' },
    lastMonth: { start: toDateInput(startOfLastMonth), end: toDateInput(endOfLastMonth), label: 'Last Month' },
    ytd: { start: toDateInput(startOfYear), end: toDateInput(now), label: 'Year to Date' },
    allTime: { start: undefined, end: undefined, label: 'All Time' },
  }
}

export default function SpendAdminPage() {
  const { session, loading } = useAuth()
  const router = useRouter()

  const presets = presetRanges()
  const [start, setStart] = useState(presets.thisMonth.start)
  const [end, setEnd] = useState(presets.thisMonth.end)

  const [summary, setSummary] = useState<SpendSummary | null>(null)
  const [orders, setOrders] = useState<PrintOrder[]>([])
  const [templates, setTemplates] = useState<ExpenseTemplate[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loadError, setLoadError] = useState('')

  const [newTemplateOpen, setNewTemplateOpen] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newTemplateCategory, setNewTemplateCategory] = useState('')
  const [newTemplateAmount, setNewTemplateAmount] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)

  const [logTemplateId, setLogTemplateId] = useState('')
  const [logAmount, setLogAmount] = useState('')
  const [logDate, setLogDate] = useState(toDateInput(new Date()))
  const [logNotes, setLogNotes] = useState('')
  const [logBusy, setLogBusy] = useState(false)

  const [oneOffOpen, setOneOffOpen] = useState(false)
  const [oneOffName, setOneOffName] = useState('')
  const [oneOffCategory, setOneOffCategory] = useState('')
  const [oneOffAmount, setOneOffAmount] = useState('')
  const [oneOffDate, setOneOffDate] = useState(toDateInput(new Date()))
  const [oneOffNotes, setOneOffNotes] = useState('')
  const [oneOffBusy, setOneOffBusy] = useState(false)

  const [editingExpenseId, setEditingExpenseId] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [expenseBusyId, setExpenseBusyId] = useState('')

  useEffect(() => {
    if (!loading && !session) router.replace('/studio')
  }, [loading, session, router])

  const refreshAll = useCallback(() => {
    if (!session) return
    const token = session.access_token
    getSpendSummary(token, start, end).then(setSummary).catch(() => setLoadError('Could not load the summary.'))
    listOrdersInRange(token, start, end).then(setOrders).catch(() => setLoadError('Could not load orders.'))
    listExpenseTemplates(token, showArchived).then(setTemplates).catch(() => setLoadError('Could not load expense templates.'))
    listExpenses(token, start, end).then(setExpenses).catch(() => setLoadError('Could not load expenses.'))
  }, [session, start, end, showArchived])

  useEffect(refreshAll, [refreshAll])

  function applyPreset(key: keyof ReturnType<typeof presetRanges>) {
    const r = presets[key]
    setStart(r.start ?? '')
    setEnd(r.end ?? '')
  }

  async function handleCreateTemplate() {
    if (!session || !newTemplateName.trim()) return
    setTemplateBusy(true)
    try {
      await createExpenseTemplate(session.access_token, {
        name: newTemplateName.trim(),
        category: newTemplateCategory.trim() || null,
        default_amount_cents: newTemplateAmount ? dollarsToCents(newTemplateAmount) : null,
      })
      setNewTemplateName('')
      setNewTemplateCategory('')
      setNewTemplateAmount('')
      setNewTemplateOpen(false)
      refreshAll()
    } catch {
      setLoadError('Could not create the template.')
    } finally {
      setTemplateBusy(false)
    }
  }

  function openLogForm(t: ExpenseTemplate) {
    setLogTemplateId(t.id)
    setLogAmount(centsToStr(t.default_amount_cents))
    setLogDate(toDateInput(new Date()))
    setLogNotes('')
  }

  async function handleLogExpense(t: ExpenseTemplate) {
    if (!session || !logAmount) return
    setLogBusy(true)
    try {
      await createExpense(session.access_token, {
        name: t.name,
        category: t.category,
        amount_cents: dollarsToCents(logAmount),
        incurred_on: logDate,
        notes: logNotes.trim() || null,
        template_id: t.id,
      })
      setLogTemplateId('')
      refreshAll()
    } catch {
      setLoadError('Could not log that expense.')
    } finally {
      setLogBusy(false)
    }
  }

  async function toggleArchiveTemplate(t: ExpenseTemplate) {
    if (!session) return
    setTemplateBusy(true)
    try {
      await updateExpenseTemplate(session.access_token, t.id, { archived: !t.archived })
      refreshAll()
    } catch {
      setLoadError('Could not update the template.')
    } finally {
      setTemplateBusy(false)
    }
  }

  async function handleDeleteTemplate(t: ExpenseTemplate) {
    if (!session) return
    if (!window.confirm(`Delete the "${t.name}" template? Expenses already logged from it are kept.`)) return
    setTemplateBusy(true)
    try {
      await deleteExpenseTemplate(session.access_token, t.id)
      refreshAll()
    } catch {
      setLoadError('Could not delete the template.')
    } finally {
      setTemplateBusy(false)
    }
  }

  async function handleCreateOneOff() {
    if (!session || !oneOffName.trim() || !oneOffAmount) return
    setOneOffBusy(true)
    try {
      await createExpense(session.access_token, {
        name: oneOffName.trim(),
        category: oneOffCategory.trim() || null,
        amount_cents: dollarsToCents(oneOffAmount),
        incurred_on: oneOffDate,
        notes: oneOffNotes.trim() || null,
        template_id: null,
      })
      setOneOffName('')
      setOneOffCategory('')
      setOneOffAmount('')
      setOneOffNotes('')
      setOneOffOpen(false)
      refreshAll()
    } catch {
      setLoadError('Could not add that expense.')
    } finally {
      setOneOffBusy(false)
    }
  }

  function startEditExpense(e: Expense) {
    setEditingExpenseId(e.id)
    setEditAmount(centsToStr(e.amount_cents))
    setEditDate(e.incurred_on)
  }

  async function saveEditExpense(e: Expense) {
    if (!session) return
    setExpenseBusyId(e.id)
    try {
      await updateExpense(session.access_token, e.id, {
        amount_cents: dollarsToCents(editAmount),
        incurred_on: editDate,
      })
      setEditingExpenseId('')
      refreshAll()
    } catch {
      setLoadError('Could not save that expense.')
    } finally {
      setExpenseBusyId('')
    }
  }

  async function handleDeleteExpense(e: Expense) {
    if (!session) return
    if (!window.confirm(`Delete this expense (${e.name}, ${fmtMoney(e.amount_cents)})?`)) return
    setExpenseBusyId(e.id)
    try {
      await deleteExpense(session.access_token, e.id)
      refreshAll()
    } catch {
      setLoadError('Could not delete that expense.')
    } finally {
      setExpenseBusyId('')
    }
  }

  if (loading || !session) return null

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Spend Management</h1>
      <p style={styles.subtitle}>Revenue and expenses, consolidated · admin only</p>
      <a href="/admin" style={styles.backLink}>&larr; Roll Print Admin</a>

      {/* Date range */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Date Range</div>
        <div style={styles.formRow}>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} style={styles.input} />
          <span style={{ color: '#7A817A', fontSize: 12 }}>to</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={styles.input} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(Object.keys(presets) as (keyof ReturnType<typeof presetRanges>)[]).map(key => (
            <button key={key} style={{ ...styles.btnSecondary, ...styles.btnSmall }} onClick={() => applyPreset(key)}>
              {presets[key].label}
            </button>
          ))}
        </div>
        {loadError && <div style={styles.error}>{loadError}</div>}
      </div>

      {/* Summary */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Summary</div>
        <div style={styles.statRow}>
          <div style={styles.statBox}>
            <div style={styles.statLabel}>Revenue</div>
            <div style={styles.statValue}>{summary ? fmtMoney(summary.revenue_cents) : '—'}</div>
          </div>
          <div style={styles.statBox}>
            <div style={styles.statLabel}>Expenses</div>
            <div style={styles.statValue}>{summary ? fmtMoney(summary.expenses_cents) : '—'}</div>
          </div>
          <div style={{ ...styles.statBox, borderColor: '#b6ccb0', background: '#eef4ec' }}>
            <div style={styles.statLabel}>Net</div>
            <div style={{ ...styles.statValue, color: summary && summary.net_cents < 0 ? '#B03A2E' : '#3f6b38' }}>
              {summary ? fmtMoney(summary.net_cents) : '—'}
            </div>
          </div>
        </div>
        {summary && summary.orders_missing_amount > 0 && (
          <div style={{ marginTop: 14, fontSize: 11, color: '#8a6d1f' }}>
            ⚠ {summary.orders_missing_amount} order{summary.orders_missing_amount === 1 ? '' : 's'} in this range have no recorded
            amount (placed before this was tracked, or the Stripe backfill couldn&rsquo;t recover a price) — revenue above is
            understated by that much.
          </div>
        )}
      </div>

      {/* Orders */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Orders{orders.length > 0 ? ` (${orders.length})` : ''}</div>
        <div style={styles.sectionDesc}>
          Every order placed in the selected range. Print status and fulfillment stay on the Roll Print Admin page — this is
          revenue only.
        </div>
        <div style={{ ...styles.list, maxHeight: 360, overflowY: 'auto' }}>
          {orders.map(o => (
            <div key={o.id} style={styles.row}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {o.title || 'Untitled'}
                <span style={{ color: '#7A817A' }}>
                  {' · '}{o.order_type === 'cart' ? 'cart' : o.order_type === 'print_gallery' ? 'gallery' : o.order_type === 'template' ? 'template' : 'own design'}
                </span>
              </span>
              {o.width_inches && o.height_inches && (
                <span style={{ fontSize: 11, color: '#7A817A', whiteSpace: 'nowrap' }}>
                  {o.width_inches.toFixed(1)}″ × {o.height_inches.toFixed(1)}″
                </span>
              )}
              {o.created_at && (
                <span style={{ fontSize: 11, color: '#9a9287', whiteSpace: 'nowrap' }}>
                  {new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
              <span style={{ fontSize: 13, fontWeight: 700, color: o.amount_total_cents == null ? '#9a9287' : '#2D332F', whiteSpace: 'nowrap', minWidth: 64, textAlign: 'right' }}>
                {o.amount_total_cents == null ? '—' : fmtMoney(o.amount_total_cents)}
              </span>
            </div>
          ))}
          {orders.length === 0 && (
            <div style={{ fontSize: 12, color: '#7A817A', padding: '8px 0' }}>No orders in this range.</div>
          )}
        </div>
      </div>

      {/* Recurring templates */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Recurring Expenses</div>
        <div style={styles.sectionDesc}>
          Save a template for expenses you pay repeatedly (canvas rolls, software, etc). The default amount just prefills the
          log form — adjust it each time to match what you actually paid.
        </div>
        <div style={styles.list}>
          {templates.map(t => (
            <div key={t.id}>
              <div style={{ ...styles.row, ...(t.archived ? { opacity: 0.55 } : {}) }}>
                <span style={{ flex: 1 }}>
                  {t.name}
                  {t.category && <span style={{ color: '#7A817A' }}> · {t.category}</span>}
                </span>
                {t.default_amount_cents != null && (
                  <span style={{ fontSize: 12, color: '#7A817A', whiteSpace: 'nowrap' }}>
                    default {fmtMoney(t.default_amount_cents)}
                  </span>
                )}
                {!t.archived && (
                  <button
                    type="button"
                    disabled={templateBusy}
                    onClick={() => openLogForm(t)}
                    style={{ ...styles.btn, ...styles.btnSmall, ...(templateBusy ? styles.btnDisabled : {}) }}
                  >
                    Log expense
                  </button>
                )}
                <button
                  type="button"
                  title={t.archived ? 'Unarchive' : 'Archive'}
                  disabled={templateBusy}
                  onClick={() => void toggleArchiveTemplate(t)}
                  style={styles.iconBtn}
                >
                  {t.archived ? '↺' : '📦'}
                </button>
                <button
                  type="button"
                  title="Delete template"
                  disabled={templateBusy}
                  onClick={() => void handleDeleteTemplate(t)}
                  style={styles.iconBtn}
                >
                  🗑
                </button>
              </div>
              {logTemplateId === t.id && (
                <div style={styles.inlineForm}>
                  <div style={styles.formRow}>
                    <label style={{ fontSize: 12 }}>Amount ($)</label>
                    <input
                      type="number" step="0.01" min="0" value={logAmount}
                      onChange={e => setLogAmount(e.target.value)} style={{ ...styles.input, width: 100 }}
                    />
                    <label style={{ fontSize: 12 }}>Date</label>
                    <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} style={styles.input} />
                  </div>
                  <div style={styles.formRow}>
                    <input
                      type="text" placeholder="Notes (optional)" value={logNotes}
                      onChange={e => setLogNotes(e.target.value)} style={{ ...styles.input, flex: 1, minWidth: 160 }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      style={{ ...styles.btn, ...styles.btnSmall, ...((logBusy || !logAmount) ? styles.btnDisabled : {}) }}
                      disabled={logBusy || !logAmount}
                      onClick={() => void handleLogExpense(t)}
                    >
                      {logBusy ? 'Saving…' : 'Save'}
                    </button>
                    <button style={{ ...styles.btnSecondary, ...styles.btnSmall }} onClick={() => setLogTemplateId('')}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {templates.length === 0 && (
            <div style={{ fontSize: 12, color: '#7A817A', padding: '8px 0' }}>No recurring templates yet.</div>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, marginTop: 12 }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived templates
        </label>

        {newTemplateOpen ? (
          <div style={styles.inlineForm}>
            <div style={styles.formRow}>
              <input
                type="text" placeholder="Name (e.g. Canvas roll)" value={newTemplateName}
                onChange={e => setNewTemplateName(e.target.value)} style={{ ...styles.input, flex: 1, minWidth: 160 }}
              />
              <input
                type="text" placeholder="Category (optional)" value={newTemplateCategory}
                onChange={e => setNewTemplateCategory(e.target.value)} style={{ ...styles.input, width: 140 }}
              />
              <input
                type="number" step="0.01" min="0" placeholder="Default $" value={newTemplateAmount}
                onChange={e => setNewTemplateAmount(e.target.value)} style={{ ...styles.input, width: 100 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={{ ...styles.btn, ...styles.btnSmall, ...((templateBusy || !newTemplateName.trim()) ? styles.btnDisabled : {}) }}
                disabled={templateBusy || !newTemplateName.trim()}
                onClick={handleCreateTemplate}
              >
                {templateBusy ? 'Saving…' : 'Save template'}
              </button>
              <button style={{ ...styles.btnSecondary, ...styles.btnSmall }} onClick={() => setNewTemplateOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button style={{ ...styles.btnSecondary, marginTop: 12 }} onClick={() => setNewTemplateOpen(true)}>
            + New template
          </button>
        )}
      </div>

      {/* All expenses */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>All Expenses{expenses.length > 0 ? ` (${expenses.length})` : ''}</div>
        <div style={styles.sectionDesc}>Every expense logged in the selected date range.</div>
        <div style={{ ...styles.list, maxHeight: 360, overflowY: 'auto' }}>
          {expenses.map(e => (
            <div key={e.id} style={styles.row}>
              {editingExpenseId === e.id ? (
                <>
                  <span style={{ flex: 1 }}>{e.name}</span>
                  <input
                    type="number" step="0.01" min="0" value={editAmount}
                    onChange={ev => setEditAmount(ev.target.value)} style={{ ...styles.input, width: 90 }}
                  />
                  <input type="date" value={editDate} onChange={ev => setEditDate(ev.target.value)} style={styles.input} />
                  <button
                    style={{ ...styles.btn, ...styles.btnSmall, ...(expenseBusyId === e.id ? styles.btnDisabled : {}) }}
                    disabled={expenseBusyId === e.id}
                    onClick={() => void saveEditExpense(e)}
                  >
                    Save
                  </button>
                  <button style={{ ...styles.btnSecondary, ...styles.btnSmall }} onClick={() => setEditingExpenseId('')}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.name}
                    {e.category && <span style={{ color: '#7A817A' }}> · {e.category}</span>}
                  </span>
                  {e.template_id && <span style={styles.tag}>recurring</span>}
                  <span style={{ fontSize: 11, color: '#9a9287', whiteSpace: 'nowrap' }}>
                    {new Date(e.incurred_on + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', minWidth: 64, textAlign: 'right' }}>
                    {fmtMoney(e.amount_cents)}
                  </span>
                  <button type="button" title="Edit" onClick={() => startEditExpense(e)} style={styles.iconBtn}>
                    ✎
                  </button>
                  <button
                    type="button" title="Delete" disabled={expenseBusyId === e.id}
                    onClick={() => void handleDeleteExpense(e)} style={styles.iconBtn}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          ))}
          {expenses.length === 0 && (
            <div style={{ fontSize: 12, color: '#7A817A', padding: '8px 0' }}>No expenses in this range.</div>
          )}
        </div>

        {oneOffOpen ? (
          <div style={styles.inlineForm}>
            <div style={styles.formRow}>
              <input
                type="text" placeholder="Name" value={oneOffName}
                onChange={e => setOneOffName(e.target.value)} style={{ ...styles.input, flex: 1, minWidth: 160 }}
              />
              <input
                type="text" placeholder="Category (optional)" value={oneOffCategory}
                onChange={e => setOneOffCategory(e.target.value)} style={{ ...styles.input, width: 140 }}
              />
              <input
                type="number" step="0.01" min="0" placeholder="Amount $" value={oneOffAmount}
                onChange={e => setOneOffAmount(e.target.value)} style={{ ...styles.input, width: 100 }}
              />
              <input type="date" value={oneOffDate} onChange={e => setOneOffDate(e.target.value)} style={styles.input} />
            </div>
            <div style={styles.formRow}>
              <input
                type="text" placeholder="Notes (optional)" value={oneOffNotes}
                onChange={e => setOneOffNotes(e.target.value)} style={{ ...styles.input, flex: 1, minWidth: 160 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={{ ...styles.btn, ...styles.btnSmall, ...((oneOffBusy || !oneOffName.trim() || !oneOffAmount) ? styles.btnDisabled : {}) }}
                disabled={oneOffBusy || !oneOffName.trim() || !oneOffAmount}
                onClick={handleCreateOneOff}
              >
                {oneOffBusy ? 'Saving…' : 'Save expense'}
              </button>
              <button style={{ ...styles.btnSecondary, ...styles.btnSmall }} onClick={() => setOneOffOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button style={{ ...styles.btnSecondary, marginTop: 12 }} onClick={() => setOneOffOpen(true)}>
            + Add one-off expense
          </button>
        )}
      </div>
    </div>
  )
}
