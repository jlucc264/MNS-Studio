import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

let client: SupabaseClient | null = null

export const isSupabaseAuthConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export function getSupabaseClient() {
  if (!isSupabaseAuthConfigured) return null
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { storageKey: 'mns-studio-auth' },
    })
  }
  return client
}
