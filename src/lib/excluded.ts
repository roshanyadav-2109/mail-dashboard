import { cache } from 'react'

import { db } from '@/lib/db'

/** A brand's exclusion rules, left out of every send (managed on the Exclusions page). Cached per request. */
export const getExcludedDomains = cache(async (brandId: string): Promise<string[]> => {
  const { data } = await db().from('excluded_domains').select('pattern').eq('brand_id', brandId)
  return (data ?? []).map((r: { pattern: string }) => r.pattern)
})
