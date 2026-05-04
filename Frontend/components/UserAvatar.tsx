import type { User } from '@supabase/supabase-js'

export function userDisplayName(user?: User | null) {
  const fullName = user?.user_metadata?.full_name
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim()
  return user?.email?.split('@')[0] ?? 'Profile'
}

export function userInitials(user?: User | null) {
  const displayName = userDisplayName(user)
  const source = displayName.includes('@') ? displayName.split('@')[0] : displayName
  const parts = source.split(/[._\-\s]+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return source.slice(0, 2).toUpperCase() || 'MS'
}

export function UserAvatar({ user, size = 38 }: { user?: User | null; size?: number }) {
  return (
    <div
      title={user?.user_metadata?.full_name ?? user?.email ?? 'Signed in'}
      aria-label={user?.user_metadata?.full_name ?? user?.email ?? 'Signed in'}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        border: '1px solid #d8d0c4',
        background: '#f0ece5',
        color: '#3f382f',
        fontSize: Math.max(11, Math.round(size * 0.34)),
        fontWeight: 800,
        flex: '0 0 auto',
      }}
    >
      {userInitials(user)}
    </div>
  )
}
