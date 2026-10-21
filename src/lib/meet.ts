import { getToken, type JWT } from 'next-auth/jwt'

// Creates Google Meet links with the signed-in person's own Google account (they become the host).
// Needs the "Google Meet REST API" enabled in the Google Cloud project that owns the login client.

export const MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.created'

/** The encrypted session token, read on the server (it holds the Meet tokens the browser never sees). */
async function sessionToken(req: Request): Promise<JWT | null> {
  const secure = new URL(req.url).protocol === 'https:'
  return getToken({ req, secret: process.env.AUTH_SECRET!, secureCookie: secure, salt: secure ? '__Secure-authjs.session-token' : 'authjs.session-token' })
}

async function accessToken(meet: NonNullable<JWT['meet']>): Promise<string | null> {
  if (meet.expires > Date.now() + 60_000) return meet.access
  if (!meet.refresh) return null
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.AUTH_GOOGLE_ID!, client_secret: process.env.AUTH_GOOGLE_SECRET!, grant_type: 'refresh_token', refresh_token: meet.refresh }),
  })
  if (!res.ok) return null
  return ((await res.json()) as { access_token?: string }).access_token ?? null
}

export type MeetResult = { ok: true; url: string } | { ok: false; reason: 'not_connected' | 'api_disabled' | 'failed'; message: string }

/** A new Meet link anyone with the link can join without waiting to be let in (where the account allows it). */
export async function createMeetLink(req: Request): Promise<MeetResult> {
  const token = await sessionToken(req)
  const access = token?.meet ? await accessToken(token.meet) : null
  if (!access) return { ok: false, reason: 'not_connected', message: 'Connect your Google account to create Meet links.' }

  const create = (body: object) =>
    fetch('https://meet.googleapis.com/v2/spaces', { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  let res = await create({ config: { accessType: 'OPEN' } })
  // Personal Gmail accounts may not allow open access; fall back to Google's default (guests ask to join).
  if (res.status === 400) res = await create({})
  if (res.status === 401) return { ok: false, reason: 'not_connected', message: 'Your Google connection expired. Connect again.' }
  if (res.status === 403) {
    const text = await res.text()
    if (/SERVICE_DISABLED|has not been used|is disabled/i.test(text)) return { ok: false, reason: 'api_disabled', message: 'Google Meet API is not enabled for this app yet.' }
    return { ok: false, reason: 'not_connected', message: 'Google did not allow creating Meet links. Connect again and allow Meet.' }
  }
  if (!res.ok) return { ok: false, reason: 'failed', message: 'Google Meet did not return a link. Try again.' }
  const space = (await res.json()) as { meetingUri?: string }
  return space.meetingUri ? { ok: true, url: space.meetingUri } : { ok: false, reason: 'failed', message: 'Google Meet did not return a link.' }
}
