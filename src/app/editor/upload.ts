'use client'

/** Uploads a file straight to storage via a signed URL from /api/uploads. */
export async function uploadFile(kind: 'image' | 'attachment', file: File): Promise<{ path: string; publicUrl: string | null }> {
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, name: file.name, type: file.type, size: file.size }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'upload failed')
  const put = await fetch(data.signedUrl, { method: 'PUT', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file })
  if (!put.ok) throw new Error('upload failed')
  return { path: data.path, publicUrl: data.publicUrl }
}
