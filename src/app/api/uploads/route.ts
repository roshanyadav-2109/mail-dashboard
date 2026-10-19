import { db } from '@/lib/db'
import { apiRole } from '@/lib/guard'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
// Types SES refuses to send (and that no one should be emailing) are blocked up front.
const BLOCKED = /\.(exe|bat|cmd|com|cpl|js|jse|jar|msi|scr|vbs|vbe|ps1|sh|hta|lnk|reg|wsf|app|dll)$/i
const LIMITS = { image: 5 * 1024 * 1024, attachment: 7 * 1024 * 1024 }

/**
 * Returns a one-time signed URL the browser uploads the file to directly (so large files never pass
 * through this server). Images go to a public bucket so inboxes can load them; attachments stay private.
 */
export async function POST(req: Request) {
  if (!(await apiRole('sender'))) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { kind, name, type, size } = (await req.json()) as { kind: 'image' | 'attachment'; name: string; type: string; size: number }
  if (kind !== 'image' && kind !== 'attachment') return Response.json({ error: 'bad kind' }, { status: 400 })
  if (!name || BLOCKED.test(name)) return Response.json({ error: 'This file type cannot be emailed.' }, { status: 400 })
  if (!(size > 0) || size > LIMITS[kind]) return Response.json({ error: `Files must be under ${LIMITS[kind] / 1024 / 1024} MB.` }, { status: 400 })
  if (kind === 'image' && !IMAGE_TYPES.includes(type)) return Response.json({ error: 'Use a PNG, JPG, GIF or WebP image.' }, { status: 400 })

  const bucket = kind === 'image' ? 'email-images' : 'attachments'
  const safe = name.replace(/[^a-z0-9._-]+/gi, '-').slice(-80)
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}-${safe}`
  const { data, error } = await db().storage.from(bucket).createSignedUploadUrl(path)
  if (error || !data) return Response.json({ error: error?.message ?? 'could not sign upload' }, { status: 500 })

  const publicUrl = kind === 'image' ? db().storage.from(bucket).getPublicUrl(path).data.publicUrl : null
  return Response.json({ signedUrl: data.signedUrl, path, publicUrl })
}
