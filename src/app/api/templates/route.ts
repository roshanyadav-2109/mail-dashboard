import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { apiRole } from '@/lib/guard'
import { cleanTemplate, type TemplateBody } from '@/lib/templates'

// Saves a new template (from the template editor or the composer's "Save as template").
export async function POST(req: Request) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const body = (await req.json()) as TemplateBody
  const { data, error } = await db()
    .from('templates')
    .insert({ name: 'Untitled template', ...cleanTemplate(body), is_starter: false, created_by: me.email })
    .select('id')
    .single()
  if (error || !data) return Response.json({ error: error?.message ?? 'failed' }, { status: 500 })
  await audit(me.email, 'template.created', { type: 'template', id: data.id }, { name: body.name })
  return Response.json({ id: data.id })
}
