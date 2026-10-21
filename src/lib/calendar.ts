// Calendar events for emails: "Add to calendar" links and a proper invite (.ics) that mail apps show with
// Yes / No / Maybe buttons. Browser-safe, so the composer can preview the links.

export type CalendarEvent = {
  title: string
  /** ISO times. For all-day events only the date part is used. */
  start: string
  end: string
  allDay?: boolean
  location?: string
  description?: string
  /** Shows as "free" so it never blocks their day: right for deadlines and reminders. */
  free?: boolean
  /** Optional video link (Google Meet, Zoom, Teams …). Only added when given; nothing is generated. */
  meetingUrl?: string
}

/** An https link, or null. */
export function cleanMeetingUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.toString().slice(0, 500) : null
  } catch {
    return null
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const utcStamp = (iso: string) => {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
}
// All-day dates in India time; the end date is exclusive in calendar formats.
const istDate = (iso: string, addDays = 0) => {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3_600_000 + addDays * 86_400_000)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

export function googleCalendarUrl(e: CalendarEvent) {
  const dates = e.allDay ? `${istDate(e.start)}/${istDate(e.end, 1)}` : `${utcStamp(e.start)}/${utcStamp(e.end)}`
  const p = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: [e.description, e.meetingUrl ? `Join: ${e.meetingUrl}` : ''].filter(Boolean).join('\n\n'), location: e.location || e.meetingUrl || '' })
  return `https://calendar.google.com/calendar/render?${p}`
}

export function outlookCalendarUrl(e: CalendarEvent) {
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.title,
    startdt: e.allDay ? new Date(e.start).toISOString().slice(0, 10) : new Date(e.start).toISOString(),
    enddt: e.allDay ? new Date(e.end).toISOString().slice(0, 10) : new Date(e.end).toISOString(),
    allday: e.allDay ? 'true' : 'false',
    body: e.description ?? '',
    location: e.location ?? '',
  })
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
// iCalendar lines must be folded at 75 octets.
const fold = (line: string) => line.match(/.{1,73}/g)?.join('\r\n ') ?? line

/** A calendar invite for one attendee (METHOD:REQUEST shows RSVP buttons; replies go to the organiser). */
export function buildIcs(e: CalendarEvent, o: { uid: string; organizer: string; organizerName?: string; attendee: string; sequence?: number }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Unknown IITians//Mail Dashboard//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${o.uid}`,
    `SEQUENCE:${o.sequence ?? 0}`,
    `DTSTAMP:${utcStamp(new Date().toISOString())}`,
    e.allDay ? `DTSTART;VALUE=DATE:${istDate(e.start)}` : `DTSTART:${utcStamp(e.start)}`,
    e.allDay ? `DTEND;VALUE=DATE:${istDate(e.end, 1)}` : `DTEND:${utcStamp(e.end)}`,
    `SUMMARY:${icsText(e.title)}`,
    e.location || e.meetingUrl ? `LOCATION:${icsText(e.location || e.meetingUrl || '')}` : '',
    e.description || e.meetingUrl ? `DESCRIPTION:${icsText([e.description, e.meetingUrl ? `Join: ${e.meetingUrl}` : ''].filter(Boolean).join('\n\n'))}` : '',
    e.meetingUrl ? `URL:${e.meetingUrl}` : '',
    // Google Calendar shows its "Join with Google Meet" button for this.
    e.meetingUrl && new URL(e.meetingUrl).hostname === 'meet.google.com' ? `X-GOOGLE-CONFERENCE:${e.meetingUrl}` : '',
    `ORGANIZER;CN=${icsText(o.organizerName ?? o.organizer)}:mailto:${o.organizer}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${o.attendee}`,
    'STATUS:CONFIRMED',
    e.free ? 'TRANSP:TRANSPARENT' : 'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Validates an event coming from the browser. Returns null if it's unusable. */
export function cleanEvent(e: unknown): CalendarEvent | null {
  if (!e || typeof e !== 'object') return null
  const x = e as Record<string, unknown>
  const title = String(x.title ?? '').trim().slice(0, 200)
  const start = new Date(String(x.start ?? ''))
  const end = new Date(String(x.end ?? x.start ?? ''))
  if (!title || Number.isNaN(start.getTime())) return null
  const safeEnd = Number.isNaN(end.getTime()) || end < start ? new Date(start.getTime() + 3_600_000) : end
  return {
    title,
    start: start.toISOString(),
    end: safeEnd.toISOString(),
    allDay: !!x.allDay,
    location: String(x.location ?? '').slice(0, 300),
    description: String(x.description ?? '').slice(0, 2000),
    free: !!x.free,
    meetingUrl: cleanMeetingUrl(x.meetingUrl) ?? undefined,
  }
}
