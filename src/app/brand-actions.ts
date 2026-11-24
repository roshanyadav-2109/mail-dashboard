'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { BRAND_COOKIE, listBrands } from '@/lib/brand'
import { requireRole } from '@/lib/guard'

/** Sidebar switcher: work in another business. Every page then shows only that brand's data. */
export async function switchBrand(id: string) {
  await requireRole('viewer')
  if (!(await listBrands()).some((b) => b.id === id)) return
  ;(await cookies()).set(BRAND_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 365 * 86_400 })
  revalidatePath('/', 'layout')
}
