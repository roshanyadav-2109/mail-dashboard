// Pre-send checks: deliverability, spam signals and email-client compatibility (Gmail, Outlook, Apple Mail).
// Pure and browser-safe so the composer can show results live; the server re-runs it before sending.

import { unknownTokens } from '@/lib/render'

export type Finding = { level: 'error' | 'warn' | 'info'; message: string }

const SPAM_WORDS = [
  '100% free', 'act now', 'buy now', 'cash bonus', 'click here', 'congratulations', 'earn money', 'free money', 'guaranteed',
  'limited time', 'no cost', 'once in a lifetime', 'risk-free', 'risk free', 'urgent', 'winner', 'you have been selected', '$$$',
]
const SHORTENERS = /https?:\/\/(bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|buff\.ly|cutt\.ly|rb\.gy)\//i

export function lint(input: { subject: string; preheader?: string; format: 'html' | 'text'; html: string; text: string; attachments?: number }): Finding[] {
  const out: Finding[] = []
  const subject = input.subject.trim()
  const body = input.format === 'html' ? input.html : input.text
  const visibleText = input.format === 'html' ? input.html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : input.text.trim()

  // Basics
  if (!subject) out.push({ level: 'error', message: 'Subject is empty.' })
  if (!body.trim()) out.push({ level: 'error', message: 'The message is empty.' })
  if (subject.length > 120) out.push({ level: 'warn', message: `Subject is ${subject.length} characters; inboxes cut it off around 60–80.` })

  // Spam signals
  const letters = subject.replace(/[^a-z]/gi, '')
  if (letters.length >= 8 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) out.push({ level: 'warn', message: 'Subject is mostly CAPITALS, a common spam signal.' })
  if (/!{2,}/.test(subject) || /!{3,}/.test(visibleText)) out.push({ level: 'warn', message: 'Repeated exclamation marks look like spam.' })
  const lower = `${subject} ${visibleText}`.toLowerCase()
  const hits = SPAM_WORDS.filter((w) => lower.includes(w))
  if (hits.length) out.push({ level: 'warn', message: `Spam-filter trigger phrases: ${hits.slice(0, 5).map((h) => `“${h}”`).join(', ')}.` })

  // Merge fields
  const bad = [...new Set(unknownTokens(`${subject} ${body}`))]
  if (bad.length) out.push({ level: 'warn', message: `Unknown merge fields will be blank: ${bad.map((b) => `{{${b}}}`).join(', ')}.` })

  // Links
  const links = [...body.matchAll(/href\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1].trim())
  const urlsInText = input.format === 'text' ? [...body.matchAll(/https?:\/\/\S+/gi)].map((m) => m[0]) : []
  const all = [...links, ...urlsInText]
  if (all.some((l) => /^javascript:/i.test(l))) out.push({ level: 'error', message: 'javascript: links are blocked by every email client.' })
  if (all.some((l) => /^http:\/\//i.test(l))) out.push({ level: 'warn', message: 'Some links use http:// — use https:// so clients don’t warn readers.' })
  if (all.some((l) => SHORTENERS.test(l))) out.push({ level: 'warn', message: 'Link shorteners (bit.ly etc.) are often flagged as spam; use full links.' })
  if (links.some((l) => !l || l === '#')) out.push({ level: 'warn', message: 'Some links are empty or point to “#”.' })

  if (input.format === 'html') {
    const html = input.html
    // Images
    const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0])
    if (imgs.some((i) => !/\balt\s*=/i.test(i))) out.push({ level: 'warn', message: 'Images without alt text show as blank boxes when images are off.' })
    if (imgs.length && visibleText.length < 80) out.push({ level: 'warn', message: 'Mostly images with little text — image-only emails often land in spam.' })
    if (imgs.some((i) => /src\s*=\s*["']http:\/\//i.test(i))) out.push({ level: 'warn', message: 'Some images load over http:// and may be blocked.' })
    if (imgs.some((i) => /src\s*=\s*["']data:/i.test(i))) out.push({ level: 'warn', message: 'Embedded data: images are blocked by Gmail and Outlook; host images online instead.' })

    // Size: Gmail clips messages over ~102 KB.
    const kb = new TextEncoder().encode(html).length / 1024
    if (kb > 100) out.push({ level: 'warn', message: `HTML is ${Math.round(kb)} KB; Gmail clips emails over ~102 KB and hides the rest.` })

    // Client compatibility
    if (/<script\b/i.test(html)) out.push({ level: 'error', message: '<script> is removed by every email client.' })
    if (/<form\b/i.test(html)) out.push({ level: 'warn', message: 'Forms don’t work in Gmail or Outlook; link to a web page instead.' })
    if (/<(video|iframe|embed|object)\b/i.test(html)) out.push({ level: 'warn', message: 'Video, iframes and embeds are not supported in email; use an image that links to the content.' })
    if (/display\s*:\s*(flex|grid|inline-flex)/i.test(html)) out.push({ level: 'warn', message: 'Outlook (Windows) ignores flexbox and grid; use tables for layout.' })
    if (/position\s*:\s*(absolute|fixed|sticky)/i.test(html)) out.push({ level: 'warn', message: 'CSS positioning is stripped by Gmail and Outlook.' })
    if (/background-image\s*:|background\s*:[^;"]*url\(/i.test(html)) out.push({ level: 'info', message: 'Background images don’t show in Outlook (Windows); keep text readable without them.' })
    if (/var\(--/i.test(html)) out.push({ level: 'warn', message: 'CSS variables are not supported in Outlook or many Gmail apps.' })
    if (/<style\b/i.test(html)) out.push({ level: 'info', message: 'Styles in <style> blocks are partly stripped by some Gmail apps; inline styles are safest.' })
    if (/<link\b[^>]*stylesheet/i.test(html)) out.push({ level: 'warn', message: 'External stylesheets are not loaded by email clients.' })
    if (/border-radius/i.test(html)) out.push({ level: 'info', message: 'Rounded corners show as square in Outlook (Windows).' })
    if (!input.preheader?.trim()) out.push({ level: 'info', message: 'No preview text — inboxes will show the first words of the email instead.' })
  }

  if ((input.attachments ?? 0) > 0) out.push({ level: 'info', message: 'Attachments make spam filtering stricter; links to files are often better for large sends.' })
  return out
}
