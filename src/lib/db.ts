import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Untyped on purpose: the schema lives in supabase/schema.sql and rows are typed where they are read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, 'public', any>

let client: Client | undefined

// Server-only: uses the service-role key, never import this from a client component.
export const db = (): Client =>
  (client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }))
