// Tells real opens/clicks apart from automatic ones. Mail providers and security tools fetch tracking images and
// follow links on their own — Gmail's scan on arrival, Google/Microsoft link checkers, Apple Mail Privacy Protection.
// Counting those would inflate open and click rates, so they are recorded separately.

type Activity = { timestamp?: string; userAgent?: string; ipAddress?: string }

// Google infrastructure (Gmail scanners, link checkers, image proxy hosts).
const GOOGLE = ['66.102.', '66.249.', '64.233.', '72.14.', '74.125.', '108.177.', '142.250.', '172.217.', '172.253.', '173.194.', '209.85.', '216.58.', '216.239.']
// Microsoft Defender / Safe Links scanners.
const MICROSOFT = ['40.92.', '40.93.', '40.94.', '40.107.', '52.100.', '52.101.', '52.102.', '52.103.', '104.47.']
const BOT_UA = /bot|crawl|spider|headless|python|curl|wget|java\/|okhttp|go-http|scan|proofpoint|mimecast|barracuda|symantec|forcepoint|trend ?micro|sophos|preview/i

const starts = (ip: string, list: string[]) => list.some((p) => ip.startsWith(p))

/**
 * Returns why an open/click looks automatic, or null if it looks like a real person.
 * `sentAt` is when the email went out; reactions within seconds of that are machines.
 */
export function automatedReason(kind: 'open' | 'click', a: Activity, sentAt: string | null): string | null {
  const ua = a.userAgent ?? ''
  const ip = a.ipAddress ?? ''
  const secs = sentAt && a.timestamp ? (new Date(a.timestamp).getTime() - new Date(sentAt).getTime()) / 1000 : Infinity

  if (BOT_UA.test(ua)) return 'security scanner'
  if (kind === 'open') {
    // Gmail shows images through its proxy when a person opens the email: that is a real open…
    if (/GoogleImageProxy/i.test(ua)) return secs < 2 ? 'scanned on arrival' : null
    // …while other requests from Google's network are its automatic scan.
    if (starts(ip, GOOGLE)) return 'Gmail scan'
    if (starts(ip, MICROSOFT)) return 'Outlook scan'
    // Apple Mail Privacy Protection preloads every email from Apple's network.
    if (ip.startsWith('17.')) return 'Apple Mail Privacy'
    if (secs < 3) return 'scanned on arrival'
    return null
  }
  // Clicks: real people click from their own network, never from Google's or Microsoft's.
  if (starts(ip, GOOGLE)) return 'Google link check'
  if (starts(ip, MICROSOFT)) return 'Microsoft link check'
  if (secs < 10) return 'link checked on arrival'
  return null
}
