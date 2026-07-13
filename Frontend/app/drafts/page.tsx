'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthPanel } from '../../components/AuthPanel'
import { useAuth } from '../../components/AuthProvider'
import { assetUrl, deleteProject, getCanvasForDesign, getMyCreatorProfile, listProjects, saveProject, updateProject, type Project, type ProjectSavePayload } from '../../lib/api'
import { NavAccountControls } from '../../components/NavAccountControls'

const btnPrimary = {
  padding: '9px 18px',
  border: '1px solid #5c7856',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  background: '#6e8d67',
  color: '#fff',
  lineHeight: 1.3,
} as const

const btnSecondary = {
  padding: '8px 14px',
  border: '1px solid #d7d0c8',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  background: '#fff',
  color: '#3f382f',
  lineHeight: 1.3,
} as const

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function effectiveDimensions(p: Project): { w: number; h: number } | null {
  const mesh = p.mesh_count ?? 13
  const cells = p.cells
  if (cells?.length && cells[0]?.length) {
    const gridH = cells.length
    const gridW = cells[0].length
    let minRow = gridH, maxRow = -1, minCol = gridW, maxCol = -1
    for (let r = 0; r < gridH; r++) {
      for (let c = 0; c < gridW; c++) {
        const cell = cells[r][c]
        if (cell !== '__BLANK__' && cell !== '__FINISH_OUTLINE__') {
          if (r < minRow) minRow = r
          if (r > maxRow) maxRow = r
          if (c < minCol) minCol = c
          if (c > maxCol) maxCol = c
        }
      }
    }
    if (maxRow >= 0) {
      return { w: (maxCol - minCol + 1) / mesh, h: (maxRow - minRow + 1) / mesh }
    }
    return { w: gridW / mesh, h: gridH / mesh }
  }
  if (p.width_inches && p.height_inches) {
    return { w: p.width_inches, h: p.height_inches }
  }
  return null
}

function formatDimensions(p: Project) {
  const dims = effectiveDimensions(p)
  if (!dims) return null
  return `${dims.w.toFixed(1)}" × ${dims.h.toFixed(1)}"`
}

function isFinalizedProject(project: Project) {
  return Boolean(project.finalized || project.pdf_url)
}

export default function DraftsPage() {
  const router = useRouter()
  const { loading: authLoading, session, user, signOut } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [hasActiveDesign, setHasActiveDesign] = useState(false)
  const [showNewDraftConfirm, setShowNewDraftConfirm] = useState(false)
  const [pendingOpenProjectId, setPendingOpenProjectId] = useState<string | null>(null)
  const [pendingReworkProjectId, setPendingReworkProjectId] = useState<string | null>(null)
  const [activeDraftName, setActiveDraftName] = useState('Untitled')
  const [showNamingModal, setShowNamingModal] = useState(false)
  const [pendingAction, setPendingAction] = useState<'new' | 'open' | null>(null)

  useEffect(() => {
    if (!session) {
      setHasActiveDesign(false)
      return
    }
    try {
      const saved = localStorage.getItem('mns_active_design')
      if (saved) {
        const d = JSON.parse(saved)
        if (d.draftName) setActiveDraftName(d.draftName)
        setHasActiveDesign(!!(d.previewImagePath || d.cells?.length > 0))
      }
    } catch {}
  }, [session])

  useEffect(() => {
    if (authLoading) return
    if (!session?.access_token) {
      setProjects([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    listProjects(session.access_token)
      .then(setProjects)
      .catch(() => setError('Could not load projects. Make sure the backend is running.'))
      .finally(() => setLoading(false))
  }, [authLoading, session?.access_token])

  useEffect(() => {
    router.prefetch('/gallery')
    router.prefetch('/studio')
  }, [router])

  async function handleDelete(id: string) {
    if (!session?.access_token) return
    try {
      await deleteProject(id, session.access_token)
      setProjects((current) => current.filter((p) => p.id !== id))
    } catch {
      setError('Could not delete project.')
    }
    setConfirmDelete(null)
  }

  function handleNewDraft() {
    if (hasActiveDesign) {
      setShowNewDraftConfirm(true)
    } else {
      router.push('/studio')
    }
  }

  function handleOpenDraft(projectId: string) {
    if (hasActiveDesign) {
      setPendingOpenProjectId(projectId)
    } else {
      router.push(`/studio?project=${projectId}`)
    }
  }

  function launchRework(projectId: string) {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    const palette = project.palette ?? []
    const cells = project.cells ?? []
    const meshCount = project.mesh_count ?? 13
    const effectiveWidth = project.width_inches ?? (cells[0]?.length ? cells[0].length / meshCount : 4)
    const effectiveHeight = project.height_inches ?? (cells.length ? cells.length / meshCount : 4)
    const settings = {
      width_inches: effectiveWidth,
      height_inches: effectiveHeight,
      mesh_count: meshCount,
      color_count: project.color_count ?? palette.length,
      contrast_level: project.contrast_level ?? 'normal',
      source_type: project.source_type ?? 'photo',
      show_grid: project.show_grid ?? true,
      clean_background: false,
      simplify_colors: false,
      strengthen_dark_detail: false,
      preserve_accents: false,
    }
    localStorage.setItem('mns_active_design', JSON.stringify({
      previewImagePath: project.preview_image_url,
      originalPreviewImagePath: project.preview_image_url,
      lastVisibleImageUrl: project.preview_image_url,
      activeImagePath: project.source_image_url,
      allPalette: palette,
      previewPalette: palette,
      enabledColorHexes: palette.map((c) => c.hex),
      cells,
      originalCells: cells,
      draftSettings: settings,
      lastSettings: settings,
      hasGeneratedPreview: true,
      viewMode: 'stitch',
      activeWorkflowStep: 2,
    }))
    router.push('/studio')
  }

  function handleRework(projectId: string) {
    if (hasActiveDesign) {
      setPendingReworkProjectId(projectId)
    } else {
      launchRework(projectId)
    }
  }

  async function saveActiveDraft(name: string) {
    try {
      const saved = localStorage.getItem('mns_active_design')
      if (saved && session?.access_token) {
        const d = JSON.parse(saved)
        const payload: ProjectSavePayload = {
          name: name.trim() || 'Untitled',
          palette: d.allPalette || null,
          cells: d.cells || null,
          source_image_url: d.activeImagePath || null,
          preview_image_url: d.previewImagePath || null,
          width_inches: d.draftSettings?.width_inches ?? null,
          height_inches: d.draftSettings?.height_inches ?? null,
          mesh_count: d.draftSettings?.mesh_count ?? null,
          color_count: d.draftSettings?.color_count ?? null,
          contrast_level: d.draftSettings?.contrast_level ?? null,
          source_type: d.draftSettings?.source_type ?? null,
          show_grid: d.draftSettings?.show_grid ?? null,
          clean_background: d.draftSettings?.clean_background ?? null,
          simplify_colors: d.draftSettings?.simplify_colors ?? null,
          strengthen_dark_detail: d.draftSettings?.strengthen_dark_detail ?? null,
          preserve_accents: d.draftSettings?.preserve_accents ?? null,
          finalized: false,
        }
        if (d.savedProjectId) {
          await updateProject(d.savedProjectId, payload, session.access_token)
        } else {
          await saveProject(payload, session.access_token)
        }
      }
    } catch {}
  }

  function needsNaming() {
    return !activeDraftName.trim() || activeDraftName.trim() === 'Untitled'
  }

  async function confirmNewDraft(save: boolean) {
    if (save && needsNaming()) {
      setShowNewDraftConfirm(false)
      setPendingAction('new')
      setShowNamingModal(true)
      return
    }
    setShowNewDraftConfirm(false)
    if (save) await saveActiveDraft(activeDraftName)
    localStorage.removeItem('mns_active_design')
    router.push('/studio')
  }

  async function confirmOpenDraft(save: boolean) {
    if (save && needsNaming()) {
      setPendingAction('open')
      setShowNamingModal(true)
      return
    }
    const projectId = pendingOpenProjectId
    setPendingOpenProjectId(null)
    if (save) await saveActiveDraft(activeDraftName)
    localStorage.removeItem('mns_active_design')
    router.push(`/studio?project=${projectId}`)
  }

  async function confirmNaming() {
    const action = pendingAction
    const projectId = pendingOpenProjectId
    await saveActiveDraft(activeDraftName)
    localStorage.removeItem('mns_active_design')
    setShowNamingModal(false)
    setPendingAction(null)
    setPendingOpenProjectId(null)
    setShowNewDraftConfirm(false)
    if (action === 'open' && projectId) {
      router.push(`/studio?project=${projectId}`)
    } else {
      router.push('/studio')
    }
  }

  async function handleSignOut() {
    setShowLogoutConfirm(false)
    setConfirmDelete(null)
    setProjects([])
    setError('')
    setLoading(false)
    localStorage.removeItem('mns_active_design')
    await signOut()
  }

  const activeProjects = projects.filter((project) => !isFinalizedProject(project))
  const finalizedProjects = projects.filter(isFinalizedProject)

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#f5f1ea',
        fontFamily: 'Georgia, "Times New Roman", serif',
        color: '#3f382f',
      }}
    >
      {/* Nav */}
      <nav
        style={{
          height: 72,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
          borderBottom: '2px solid #6e8d67',
          background: '#fffdf8',
          boxSizing: 'border-box',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            href="/gallery"
            style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}
          >
            <div
              aria-hidden="true"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 3, padding: 2 }}
            >
              {Array.from({ length: 9 }, (_, i) => (
                <span
                  key={i}
                  style={{
                    width: 9,
                    height: 9,
                    border: '2px solid #111',
                    borderRadius: 2,
                    boxSizing: 'border-box',
                  }}
                />
              ))}
            </div>
            <strong style={{ fontSize: 22, color: '#111' }}>MNS Studio</strong>
          </Link>
          <span style={{ color: '#d8d0c4', margin: '0 6px' }}>|</span>
          <div style={{ display: 'flex', gap: 24, color: '#7f776d', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <Link href="/gallery" style={{ color: '#7f776d', textDecoration: 'none' }}>Gallery</Link>
            <span style={{ color: '#3f382f', fontWeight: 700 }}>Your Studio</span>
            <Link href="/contact" style={{ color: '#7f776d', textDecoration: 'none' }}>Contact Us</Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {session && (
            <NavAccountControls
              user={user}
              onProfile={async () => {
                if (!session?.access_token) return
                try {
                  const profile = await getMyCreatorProfile(session.access_token)
                  router.push(profile.slug ? `/gallery/${profile.slug}` : '/gallery')
                } catch {
                  router.push('/gallery')
                }
              }}
              onLogout={() => setShowLogoutConfirm(true)}
              onStudio={() => router.push('/studio')}
              onAdmin={() => router.push('/admin')}
            />
          )}
        </div>
      </nav>

      {hasActiveDesign && (
        <div style={{ background: '#eee7dc', borderBottom: '1px solid #d8cfc5', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', flexWrap: 'wrap', textAlign: 'center' }}>
          <span style={{ color: '#5c4a3a', fontSize: 14 }}>Active design: <strong>{activeDraftName}</strong></span>
          <Link href="/studio" style={{ color: '#3f382f', fontWeight: 700, fontSize: 14 }}>Continue editing →</Link>
        </div>
      )}

      {/* Content */}
      <main style={{ padding: 'clamp(16px, 4vw, 32px) clamp(16px, 4vw, 32px) 48px', maxWidth: 1000, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Your Designs</h1>
            {!loading && !error && (
              <span style={{ fontSize: 13, color: '#8a8177' }}>
                {activeProjects.length} draft{activeProjects.length !== 1 ? 's' : ''} · {finalizedProjects.length} finalized
              </span>
            )}
          </div>

          {!authLoading && !session ? (
            <AuthPanel />
          ) : error ? (
            <p style={{ margin: 0, fontSize: 14, color: '#b0453a' }}>{error}</p>
          ) : null}

          {authLoading || loading ? (
            <p style={{ margin: 0, fontSize: 14, color: '#8a8177' }}>Loading…</p>
          ) : !session ? null : projects.length === 0 && !error ? (
            <EmptyState />
          ) : (
            <div style={{ display: 'grid', gap: 28 }}>
              <ProjectSection
                title="Active Drafts"
                emptyText="No active drafts right now."
                projects={activeProjects}
                onDeleteRequest={setConfirmDelete}
                onNewDraft={() => void handleNewDraft()}
                onOpenDraft={handleOpenDraft}
              />
              {finalizedProjects.length > 0 && (
                <ProjectSection
                  title="Finalized Designs"
                  emptyText=""
                  projects={finalizedProjects}
                  onDeleteRequest={setConfirmDelete}
                  onNewDraft={() => void handleNewDraft()}
                  onOpenDraft={handleOpenDraft}
                  onRework={handleRework}
                  finalized
                />
              )}
            </div>
          )}
        </div>
      </main>
      {showLogoutConfirm && (
        <div role="dialog" aria-modal="true" onClick={() => setShowLogoutConfirm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 40, padding: 18 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ background: '#fffdf8', padding: 24, borderRadius: 12, width: 360, maxWidth: '100%', display: 'grid', gap: 14, boxSizing: 'border-box' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0 }}>Log out?</h2>
              {hasActiveDesign ? (
                <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                  <strong>{activeDraftName}</strong> is still open. Logging out will discard it — go to the studio to save it as a draft first.
                </p>
              ) : (
                <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                  You will need to log back in to access saved projects.
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setShowLogoutConfirm(false)} style={btnSecondary}>Cancel</button>
              {hasActiveDesign && (
                <button type="button" onClick={() => { setShowLogoutConfirm(false); router.push('/studio') }} style={btnSecondary}>Go to studio</button>
              )}
              <button type="button" onClick={() => void handleSignOut()} style={btnPrimary}>{hasActiveDesign ? 'Log out anyway' : 'Log out'}</button>
            </div>
          </div>
        </div>
      )}
      {showNewDraftConfirm && (
        <div role="dialog" aria-modal="true" onClick={() => setShowNewDraftConfirm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 40, padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fffdf8', padding: 24, borderRadius: 12, width: 380, maxWidth: '100%', display: 'grid', gap: 14, boxSizing: 'border-box' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0 }}>Start a new design?</h2>
              <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                <strong>{activeDraftName}</strong> is still open. Would you like to save it before starting fresh?
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" onClick={() => void confirmNewDraft(true)} style={btnPrimary}>
                Save and start new
              </button>
              <button type="button" onClick={() => void confirmNewDraft(false)} style={btnSecondary}>
                Discard and start new
              </button>
              <button type="button" onClick={() => setShowNewDraftConfirm(false)} style={{ ...btnSecondary, color: '#8a8177' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingOpenProjectId && !showNamingModal && (
        <div role="dialog" aria-modal="true" onClick={() => setPendingOpenProjectId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 40, padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fffdf8', padding: 24, borderRadius: 12, width: 380, maxWidth: '100%', display: 'grid', gap: 14, boxSizing: 'border-box' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0 }}>Open this design?</h2>
              <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                <strong>{activeDraftName}</strong> is still open. Save it before switching?
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" onClick={() => void confirmOpenDraft(true)} style={btnPrimary}>
                Save and open
              </button>
              <button type="button" onClick={() => void confirmOpenDraft(false)} style={btnSecondary}>
                Discard and open
              </button>
              <button type="button" onClick={() => setPendingOpenProjectId(null)} style={{ ...btnSecondary, color: '#8a8177' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingReworkProjectId && (
        <div role="dialog" aria-modal="true" onClick={() => setPendingReworkProjectId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 40, padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fffdf8', padding: 24, borderRadius: 12, width: 380, maxWidth: '100%', display: 'grid', gap: 14, boxSizing: 'border-box' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0 }}>Rework this design?</h2>
              <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                <strong>{activeDraftName}</strong> is still open. Save it before starting a rework?
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" onClick={async () => { await saveActiveDraft(activeDraftName); localStorage.removeItem('mns_active_design'); launchRework(pendingReworkProjectId); setPendingReworkProjectId(null) }} style={btnPrimary}>
                Save and rework
              </button>
              <button type="button" onClick={() => { localStorage.removeItem('mns_active_design'); launchRework(pendingReworkProjectId); setPendingReworkProjectId(null) }} style={btnSecondary}>
                Discard and rework
              </button>
              <button type="button" onClick={() => setPendingReworkProjectId(null)} style={{ ...btnSecondary, color: '#8a8177' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showNamingModal && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 18 }}>
          <div style={{ background: '#fffdf8', padding: 24, borderRadius: 12, width: 380, maxWidth: '100%', display: 'grid', gap: 14, boxSizing: 'border-box' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0 }}>Name your design</h2>
            </div>
            <input
              value={activeDraftName === 'Untitled' ? '' : activeDraftName}
              onChange={(e) => setActiveDraftName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && activeDraftName.trim()) void confirmNaming() }}
              placeholder="Design name"
              autoFocus
              style={{ border: '1px solid #d7d0c8', borderRadius: 8, padding: '10px 12px', font: 'inherit', fontSize: 14, width: '100%', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => void confirmNaming()}
                disabled={!activeDraftName.trim()}
                style={{ ...btnPrimary, opacity: !activeDraftName.trim() ? 0.5 : 1, cursor: !activeDraftName.trim() ? 'not-allowed' : 'pointer' }}
              >
                Save and continue
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (() => {
        const project = projects.find((p) => p.id === confirmDelete)
        const isFinalized = project ? Boolean(project.finalized || project.pdf_url) : false
        return (
          <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 18 }}>
            <div style={{ background: '#fffdf8', padding: 24, borderRadius: 12, width: 400, maxWidth: '100%', display: 'grid', gap: 16, boxSizing: 'border-box', border: '1px solid #e7e1d8' }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>Delete this design?</h2>
                <p style={{ margin: 0, color: '#6f675f', fontSize: 14, lineHeight: 1.5 }}>
                  {isFinalized
                    ? 'This will permanently delete the design, its PDF, and remove it from the gallery if it was shared.'
                    : 'This will permanently delete this draft. This cannot be undone.'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setConfirmDelete(null)} style={btnSecondary}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(confirmDelete)}
                  style={{ ...btnSecondary, color: '#b0453a', borderColor: '#e0b0aa' }}
                >
                  Delete permanently
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function ProjectSection({
  title,
  emptyText,
  projects,
  onDeleteRequest,
  onNewDraft,
  onOpenDraft,
  onRework,
  finalized = false,
}: {
  title: string
  emptyText: string
  projects: Project[]
  onDeleteRequest: (id: string) => void
  onNewDraft: () => void
  onOpenDraft: (id: string) => void
  onRework?: (id: string) => void
  finalized?: boolean
}) {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <span style={{ fontSize: 12, color: '#8a8177' }}>{projects.length}</span>
      </div>
      {projects.length === 0 ? (
        finalized ? (
          <div style={{ border: '1px dashed #d7d0c8', borderRadius: 12, padding: 18, color: '#8a8177', fontSize: 14 }}>
            {emptyText}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            <NewDraftCard onClick={onNewDraft} />
          </div>
        )
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {!finalized && <NewDraftCard onClick={onNewDraft} />}
          {projects.map((project) => (
            <DraftCard
              key={project.id}
              project={project}
              dimensions={formatDimensions(project)}
              onDeleteRequest={() => onDeleteRequest(project.id)}
              onOpen={() => onOpenDraft(project.id)}
              onRework={onRework ? () => onRework(project.id) : undefined}
              finalized={finalized}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function NewDraftCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 282,
        border: '2px dashed #d7d0c8',
        borderRadius: 14,
        background: '#fffdf8',
        display: 'grid',
        placeItems: 'center',
        color: '#7f776d',
        boxSizing: 'border-box',
        cursor: 'pointer',
        width: '100%',
        fontFamily: 'inherit',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 54,
          height: 54,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          border: '1px solid #d7d0c8',
          color: '#6e8d67',
          background: '#f5f1ea',
          fontSize: 36,
          lineHeight: 1,
          fontWeight: 400,
        }}
      >
        +
      </span>
    </button>
  )
}

function DraftCard({
  project,
  dimensions,
  onDeleteRequest,
  onOpen,
  onRework,
  finalized = false,
}: {
  project: Project
  dimensions: string | null
  onDeleteRequest: () => void
  onOpen: () => void
  onRework?: () => void
  finalized?: boolean
}) {
  const reportUrl = assetUrl(project.pdf_url)

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e7e1d8',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        display: 'grid',
        gridTemplateRows: '160px 1fr',
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          background: '#f0ece5',
          display: 'grid',
          placeItems: 'center',
          borderBottom: '1px solid #e7e1d8',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <DraftThumbnail project={project} />
        {isFinalizedProject(project) && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              background: '#6e8d67',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 20,
              letterSpacing: 0.5,
            }}
          >
            Finalized
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '14px 16px 16px', display: 'grid', gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{project.name}</div>
          <div style={{ fontSize: 12, color: '#8a8177' }}>
            {[
              dimensions,
              project.mesh_count ? `${project.mesh_count} mesh` : null,
              project.color_count ? `${project.color_count} colors` : null,
              (() => { const d = effectiveDimensions(project); return d ? `${getCanvasForDesign(d.w, d.h).label} canvas` : null })(),
            ]
              .filter(Boolean)
              .join(' · ') || 'No preview yet'}
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#a09890' }}>
          Edited {formatDate(project.updated_at)}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {finalized ? (
            <>
              <button type="button" onClick={onOpen} style={{ ...btnSecondary, flex: 1, minWidth: 80 }}>
                Manage
              </button>
              {reportUrl ? (
                <a
                  href={reportUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block', lineHeight: 1, flex: 1, textAlign: 'center', minWidth: 80 }}
                >
                  View PDF
                </a>
              ) : (
                <button type="button" disabled style={{ ...btnSecondary, opacity: 0.55, cursor: 'not-allowed', flex: 1, minWidth: 80 }}>
                  PDF unavailable
                </button>
              )}
              {onRework && (
                <button type="button" onClick={onRework} style={{ ...btnPrimary, flex: 1, minWidth: 80 }}>
                  Rework
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={onOpen} style={{ ...btnPrimary, flex: 1 }}>
              Open
            </button>
          )}
          <button type="button" onClick={onDeleteRequest} style={{ ...btnSecondary, padding: '7px 10px' }}>
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

function DraftThumbnail({ project }: { project: Project }) {
  const [loadFailed, setLoadFailed] = useState(false)
  const thumbnailUrl = project.preview_image_url
    ? project.preview_image_url.startsWith('http')
      ? project.preview_image_url
      : assetUrl(project.preview_image_url)
    : null

  if (thumbnailUrl && !loadFailed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={thumbnailUrl}
        alt={project.name}
        onError={() => setLoadFailed(true)}
        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f8f4ec' }}
      />
    )
  }

  return <DraftThumbnailPlaceholder />
}

function DraftThumbnailPlaceholder() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 12px)',
        gap: 3,
        opacity: 0.25,
      }}
    >
      {Array.from({ length: 48 }, (_, i) => (
        <span
          key={i}
          style={{
            width: 12,
            height: 12,
            border: '1.5px solid #5a5348',
            borderRadius: 2,
            background: i % 7 === 0 ? '#c8b89a' : i % 5 === 0 ? '#8a6a52' : 'transparent',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        gap: 20,
        padding: '80px 24px',
        border: '2px dashed #d7d0c8',
        borderRadius: 16,
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden="true"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 14px)', gap: 4, opacity: 0.3 }}
      >
        {Array.from({ length: 25 }, (_, i) => (
          <span
            key={i}
            style={{
              width: 14,
              height: 14,
              border: '2px solid #5a5348',
              borderRadius: 2,
              background: i === 12 ? '#6e8d67' : 'transparent',
              boxSizing: 'border-box',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>No designs yet</p>
        <p style={{ margin: 0, fontSize: 14, color: '#8a8177' }}>
          Start a new project and your work will appear here.
        </p>
      </div>
      <Link
        href="/studio"
        style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block', lineHeight: 1 }}
      >
        Start your first design
      </Link>
    </div>
  )
}
