import { cache } from 'react'

import { db } from '@/lib/db'

/** Domains left out of every send (managed on the Excluded domains page). Cached per request. */
export const getExcludedDomains = cache(async (): Promise<string[]> => {
  const { data } = await db().from('excluded_domains').select('pattern')
  return (data ?? []).map((r: { pattern: string }) => r.pattern)
})
