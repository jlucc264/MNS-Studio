'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AuthPanel } from '../../components/AuthPanel'
import { useAuth } from '../../components/AuthProvider'
import { assetUrl, deleteProject, listProjects, type Project } from '../../lib/api'
import { ProfileModal } from '../../components/ProfileModal'
import { UserAvatar, userDisplayName } from '../../components/UserAvatar'

const btnPrimary = {
  padding: '9px 18px',
  border: 'none',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  background: '#6e8d67',
  color: '#fff',
} as const

const btnSecondary = {
  padding: '7px 14px',
  border: '1px solid #d7d0c8',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  background: '#fff',
  color: '#3f382f',
} as const

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDimensions(p: Project) {
  if (p.width_inches && p.height_inches) {
    return `${p.width_inches.toFixed(1)}" × ${p.height_inches.toFixed(1)}"`
  }
  return null
}

export default function DraftsPage() {
  const { loading: authLoading, session, user, signOut } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)

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

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateRows: '72px 1fr',
        background: '#f5f1ea',
        fontFamily: 'Georgia, "Times New Roman", serif',
        color: '#3f382f',
      }}
    >
      {/* Nav */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 32px',
          borderBottom: '1px solid #e7e1d8',
          background: '#fffdf8',
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
            <span style={{ color: '#3f382f', fontWeight: 700 }}>Projects</span>
            <Link href="/studio" style={{ color: '#7f776d', textDecoration: 'none' }}>Active Canvas</Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {session && (
            <>
              <UserAvatar user={user} />
              <button type="button" onClick={() => setShowProfileModal(true)} style={{ border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: '#8a8177', cursor: 'pointer' }}>
                {userDisplayName(user)}
              </button>
            </>
          )}
          {session && (
            <button type="button" onClick={() => setShowLogoutConfirm(true)} style={btnSecondary}>
              Log out
            </button>
          )}
        </div>
      </nav>

      {/* Content */}
      <main style={{ padding: '32px 32px 48px', maxWidth: 1000, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Your Designs</h1>
            {!loading && !error && (
              <span style={{ fontSize: 13, color: '#8a8177' }}>
                {projects.length} project{projects.length !== 1 ? 's' : ''}
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
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              {projects.map((project) => (
                <DraftCard
                  key={project.id}
                  project={project}
                  dimensions={formatDimensions(project)}
                  confirmingDelete={confirmDelete === project.id}
                  onDeleteRequest={() => setConfirmDelete(project.id)}
                  onDeleteCancel={() => setConfirmDelete(null)}
                  onDeleteConfirm={() => void handleDelete(project.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>
      {showLogoutConfirm && (
        <div role="dialog" aria-modal="true" onClick={() => setShowLogoutConfirm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 40, padding: 18 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ background: 'white', padding: 24, borderRadius: 12, width: 360, maxWidth: '100%', display: 'grid', gap: 14, boxSizing: 'border-box' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0 }}>Log out?</h2>
              <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                You will need to log back in to access saved projects.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowLogoutConfirm(false)} style={btnSecondary}>Cancel</button>
              <button type="button" onClick={() => { setShowLogoutConfirm(false); void signOut() }} style={btnPrimary}>Log out</button>
            </div>
          </div>
        </div>
      )}
      {showProfileModal && <ProfileModal onClose={() => setShowProfileModal(false)} />}
    </div>
  )
}

function DraftCard({
  project,
  dimensions,
  confirmingDelete,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  project: Project
  dimensions: string | null
  confirmingDelete: boolean
  onDeleteRequest: () => void
  onDeleteCancel: () => void
  onDeleteConfirm: () => void
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e7e1d8',
        borderRadius: 14,
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
        {project.preview_image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={project.preview_image_url.startsWith('http') ? project.preview_image_url : assetUrl(project.preview_image_url) ?? ''}
            alt={project.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
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
        )}
        {project.finalized && (
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
            PDF ready
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
            ]
              .filter(Boolean)
              .join(' · ') || 'No preview yet'}
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#a09890' }}>
          Edited {formatDate(project.updated_at)}
        </div>

        {confirmingDelete ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>Delete this design?</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onDeleteConfirm} style={{ ...btnSecondary, color: '#b0453a', borderColor: '#e0b0aa', flex: 1 }}>
                Delete
              </button>
              <button type="button" onClick={onDeleteCancel} style={{ ...btnSecondary, flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <Link
              href={`/studio?project=${project.id}`}
              style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block', lineHeight: 1, flex: 1, textAlign: 'center' }}
            >
              Open
            </Link>
            <button type="button" onClick={onDeleteRequest} style={{ ...btnSecondary, padding: '7px 10px' }}>
              ×
            </button>
          </div>
        )}
      </div>
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
