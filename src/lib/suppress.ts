import { db } from '@/lib/db'

export type Reason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual'

/** Adds an address to the suppression list (keeps the first reason) and cancels its unsent messages. */
export async function suppress(email: string, reason: Reason, detail?: string) {
  const address = email.trim().toLowerCase()
  const sb = db()
  await sb.from('suppressions').upsert({ email: address, reason, detail }, { onConflict: 'email', ignoreDuplicates: true })
  await sb
    .from('messages')
    .update({ status: 'suppressed', updated_at: new Date().toISOString() })
    .eq('email', address)
    .in('status', ['queued', 'sending'])
}
