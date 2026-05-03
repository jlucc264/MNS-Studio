'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient, isSupabaseAuthConfigured } from '../lib/supabase'

type AuthContextValue = {
  configured: boolean
  loading: boolean
  session: Session | null
  user: User | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseAuthConfigured)

  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) {
      setLoading(false)
      return
    }

    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isSupabaseAuthConfigured,
      loading,
      session,
      user: session?.user ?? null,
      async signIn(email, password) {
        const supabase = getSupabaseClient()
        if (!supabase) throw new Error('Supabase Auth is not configured.')
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw new Error(error.message)
      },
      async signUp(email, password) {
        const supabase = getSupabaseClient()
        if (!supabase) throw new Error('Supabase Auth is not configured.')
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw new Error(error.message)
      },
      async signOut() {
        const supabase = getSupabaseClient()
        if (!supabase) return
        await supabase.auth.signOut()
      },
    }),
    [loading, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}
