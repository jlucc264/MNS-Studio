import type { User } from '@supabase/supabase-js'
import { UserAvatar } from './UserAvatar'

const navButton = {
  border: 0,
  background: 'transparent',
  padding: 0,
  cursor: 'pointer',
  font: 'inherit',
} as const

const logoutButton = {
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

export function NavAccountControls({
  user,
  isMobile = false,
  onProfile,
  onLogout,
}: {
  user?: User | null
  isMobile?: boolean
  onProfile: () => void
  onLogout: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, flexShrink: 0 }}>
      <button type="button" aria-label="Open profile" onClick={onProfile} style={navButton}>
        <UserAvatar user={user} />
      </button>
      {!isMobile && (
        <button type="button" onClick={onLogout} style={logoutButton}>
          Log out
        </button>
      )}
    </div>
  )
}
