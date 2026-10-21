'use server'

import { signIn } from '@/auth'
import { requireRole } from '@/lib/guard'
import { MEET_SCOPE } from '@/lib/meet'

/** Sends the person through Google once to allow creating Meet links, then back to the same draft. */
export async function connectMeet(draftId: string | null) {
  await requireRole('sender')
  const back = draftId && /^[0-9a-f-]{36}$/.test(draftId) ? `/compose?draft=${draftId}&meet=1` : '/compose?meet=1'
  await signIn('google', { redirectTo: back }, { scope: `openid email profile ${MEET_SCOPE}`, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' })
}
