import { cookies } from 'next/headers'
import { cache } from 'react'

import { db } from '@/lib/db'

// Businesses that share this dashboard. Each has its own sending domain, contacts, campaigns and unsubscribes.

export type Brand = { id: string; name: string; domain: string; sender_local: string; sender_name: string; reply_to: string | null }

export const DEFAULT_BRAND = 'unknowniitians'
export const BRAND_COOKIE = 'brand'

/** Domains mail may ever be sent from. A brand row pointing anywhere else is refused at send time. */
export const SENDING_DOMAINS = ['unknowniitians.in', 'iilmgn.space']

export const listBrands = cache(async (): Promise<Brand[]> => {
  const { data } = await db().from('brands').select('*').order('created_at')
  return (data ?? []) as Brand[]
})

export async function getBrand(id: string | null | undefined): Promise<Brand> {
  const all = await listBrands()
  return all.find((b) => b.id === id) ?? all.find((b) => b.id === DEFAULT_BRAND) ?? all[0]
}

/** The brand picked in the sidebar switcher (dashboard pages and API routes). */
export const currentBrand = cache(async (): Promise<Brand> => {
  const jar = await cookies()
  return getBrand(jar.get(BRAND_COOKIE)?.value)
})

/** The verified From address for a brand; refuses any domain that is not on the allow-list. */
export function brandAddress(b: Pick<Brand, 'sender_local' | 'domain'>): string {
  const domain = b.domain.toLowerCase()
  if (!SENDING_DOMAINS.includes(domain)) throw new Error(`Sending from ${domain} is not allowed`)
  if (!/^[a-z0-9._+-]+$/i.test(b.sender_local)) throw new Error('Invalid sender address')
  return `${b.sender_local}@${domain}`
}

/** Suppression scopes that block email for a brand: shared (bounce, complaint) plus the brand's own. */
export const blockingScopes = (brandId: string) => ['*', brandId]
