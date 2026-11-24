import { audit } from '@/lib/audit'
import { fetchAll, type Contact } from '@/lib/audience'
import { currentBrand } from '@/lib/brand'
import { db } from '@/lib/db'
import { contactsCsv, csvResponse } from '@/lib/export'
import { apiRole } from '@/lib/guard'

export async function GET(req: Request) {
  const me = await apiRole('sender')
  if (!me) return new Response('forbidden', { status: 403 })
  const tag = new URL(req.url).searchParams.get('tag')
  const brand = await currentBrand()
  const rows = await fetchAll<Contact>((from, to) => {
    let q = db().from('contacts').select('email, name, tags, fields').eq('brand_id', brand.id).order('email')
    if (tag) q = q.contains('tags', [tag])
    return q.range(from, to)
  })
  await audit(me.email, 'contacts.exported', { type: 'contacts' }, { count: rows.length, tag, brand: brand.id })
  return csvResponse(contactsCsv(rows), `contacts${tag ? `-${tag}` : ''}.csv`)
}
