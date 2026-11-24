import { currentBrand } from '@/lib/brand'
import { db } from '@/lib/db'

/** Whether the campaign exists and belongs to the business picked in the sidebar (API routes answer 404 otherwise). */
export async function ownedCampaign(id: string): Promise<boolean> {
  const brand = await currentBrand()
  const { data } = await db().from('campaigns').select('id').eq('id', id).eq('brand_id', brand.id).maybeSingle()
  return !!data
}

export const notFound = () => Response.json({ error: 'not found' }, { status: 404 })
