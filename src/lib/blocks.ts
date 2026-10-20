import { googleCalendarUrl, outlookCalendarUrl } from '@/lib/calendar'

// Visual builder model and its HTML output. The HTML is table-based with inline styles, the format that renders
// reliably in Gmail, Outlook (including Windows desktop) and Apple Mail. Browser-safe: used live in the editor.

export type Align = 'left' | 'center' | 'right'

export type Block =
  | { id: string; type: 'heading'; text: string; size: 'lg' | 'md' | 'sm'; align: Align }
  | { id: string; type: 'text'; text: string; align: Align }
  | { id: string; type: 'button'; label: string; url: string; align: Align }
  | { id: string; type: 'image'; src: string; alt: string; href: string; width: number; align: Align }
  | { id: string; type: 'columns'; left: string; right: string }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; height: number }
  | { id: string; type: 'footer'; text: string }
  | { id: string; type: 'event'; title: string; start: string; end: string; allDay: boolean; location: string; details: string }

export type Theme = { accent: string; background: string; card: string; text: string; font: string; width: number }
export type Doc = { theme: Theme; blocks: Block[] }
export type BlockType = Block['type']

export const FONTS = {
  Arial: 'Arial, Helvetica, sans-serif',
  Helvetica: 'Helvetica, Arial, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
  Georgia: 'Georgia, "Times New Roman", serif',
  Trebuchet: '"Trebuchet MS", Arial, sans-serif',
} as const

export const DEFAULT_THEME: Theme = { accent: '#f6821f', background: '#f4f4f5', card: '#ffffff', text: '#1f2328', font: 'Arial', width: 600 }

export const uid = () => Math.random().toString(36).slice(2, 10)

export function newBlock(type: BlockType): Block {
  const id = uid()
  switch (type) {
    case 'heading':
      return { id, type, text: 'Your headline', size: 'lg', align: 'left' }
    case 'text':
      return { id, type, text: 'Write something here. Use **bold**, *italic* and [links](https://example.com).', align: 'left' }
    case 'button':
      return { id, type, label: 'Learn more', url: 'https://', align: 'left' }
    case 'image':
      return { id, type, src: 'https://placehold.co/1200x600/png?text=Image', alt: 'Image description', href: '', width: 600, align: 'center' }
    case 'columns':
      return { id, type, left: '**Left column**\nText here.', right: '**Right column**\nText here.' }
    case 'divider':
      return { id, type }
    case 'spacer':
      return { id, type, height: 24 }
    case 'footer':
      return { id, type, text: 'Unknown IITians · You’re receiving this because you signed up.' }
    case 'event': {
      const start = new Date(Date.now() + 86_400_000)
      start.setMinutes(0, 0, 0)
      return { id, type, title: 'Live session', start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), allDay: false, location: 'Online', details: '' }
    }
  }
}

export const defaultDoc = (): Doc => ({
  theme: { ...DEFAULT_THEME },
  blocks: [newBlock('heading'), newBlock('text'), newBlock('button')],
})

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const SAFE_URL = /^(https?:|mailto:|tel:|\{\{)/i
const safeUrl = (u: string) => (SAFE_URL.test(u.trim()) ? esc(u.trim()) : '#')

/** Tiny formatting language for text blocks: **bold**, *italic*, [label](url) and line breaks. */
export function inline(text: string, accent: string): string {
  return esc(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => `<a href="${safeUrl(url.replace(/&amp;/g, '&'))}" style="color:${accent};text-decoration:underline">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

const SIZES = { lg: 28, md: 22, sm: 18 }

function blockHtml(b: Block, t: Theme): string {
  const font = FONTS[t.font as keyof typeof FONTS] ?? FONTS.Arial
  const cell = (inner: string, pad = '12px 32px', align: Align = 'left') =>
    `<tr><td align="${align}" style="padding:${pad};font-family:${font};color:${t.text};text-align:${align}">${inner}</td></tr>`
  switch (b.type) {
    case 'heading':
      return cell(
        `<h1 style="margin:0;font-family:${font};font-size:${SIZES[b.size]}px;line-height:1.25;font-weight:700;color:${t.text}">${inline(b.text, t.accent)}</h1>`,
        '20px 32px 8px',
        b.align,
      )
    case 'text':
      return cell(`<p style="margin:0;font-size:16px;line-height:1.6">${inline(b.text, t.accent)}</p>`, '8px 32px', b.align)
    case 'button':
      return cell(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table"><tr><td bgcolor="${t.accent}" style="border-radius:6px;background:${t.accent}">` +
          `<a href="${safeUrl(b.url)}" style="display:inline-block;padding:12px 24px;font-family:${font};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px">${esc(b.label)}</a>` +
          `</td></tr></table>`,
        '16px 32px',
        b.align,
      )
    case 'image': {
      const w = Math.min(b.width || t.width, t.width)
      const img = `<img src="${safeUrl(b.src)}" alt="${esc(b.alt)}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none${b.align === 'center' ? ';margin:0 auto' : ''}">`
      return cell(b.href ? `<a href="${safeUrl(b.href)}">${img}</a>` : img, '8px 0', b.align)
    }
    case 'columns':
      return (
        `<tr><td style="padding:8px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td width="50%" valign="top" style="padding:0 8px;font-family:${font};font-size:15px;line-height:1.6;color:${t.text}">${inline(b.left, t.accent)}</td>` +
        `<td width="50%" valign="top" style="padding:0 8px;font-family:${font};font-size:15px;line-height:1.6;color:${t.text}">${inline(b.right, t.accent)}</td>` +
        `</tr></table></td></tr>`
      )
    case 'divider':
      return `<tr><td style="padding:16px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e5e7eb;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>`
    case 'spacer':
      return `<tr><td style="height:${Math.max(4, Math.min(120, b.height))}px;font-size:0;line-height:0">&nbsp;</td></tr>`
    case 'footer':
      return cell(`<p style="margin:0;font-size:12px;line-height:1.5;color:#6b7280">${inline(b.text, t.accent)}</p>`, '20px 32px 24px', 'center')
    case 'event': {
      const ev = { title: b.title, start: b.start, end: b.end, allDay: b.allDay, location: b.location, description: b.details }
      const fmt = (iso: string, withTime: boolean) =>
        new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', ...(withTime ? { timeStyle: 'short' } : {}) })
      const when = b.allDay ? fmt(b.start, false) : `${fmt(b.start, true)} – ${new Date(b.end).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' })} IST`
      const btn = (href: string, label: string) =>
        `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 0 0;padding:9px 16px;border:1px solid ${t.accent};border-radius:6px;color:${t.accent};font-family:${font};font-size:14px;font-weight:700;text-decoration:none">${label}</a>`
      return cell(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:8px"><tr><td style="padding:16px 18px;font-family:${font};color:${t.text}">` +
          `<div style="font-size:17px;font-weight:700;margin-bottom:6px">📅 ${esc(b.title)}</div>` +
          `<div style="font-size:14px;line-height:1.6">${esc(when)}${b.location ? `<br>📍 ${esc(b.location)}` : ''}</div>` +
          (b.details ? `<div style="font-size:14px;line-height:1.6;margin-top:6px;color:#4b5563">${inline(b.details, t.accent)}</div>` : '') +
          `<div style="margin-top:10px">${btn(googleCalendarUrl(ev), 'Add to Google Calendar')}${btn(outlookCalendarUrl(ev), 'Add to Outlook')}</div>` +
          `</td></tr></table>`,
        '12px 32px',
      )
    }
  }
}

/** Full, standalone email HTML for a builder document. */
export function blocksToHtml(doc: Doc): string {
  const t = doc.theme
  const w = Math.max(400, Math.min(800, t.width || 600))
  return [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title></title></head>',
    `<body style="margin:0;padding:0;background:${t.background}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.background}"><tr><td align="center" style="padding:24px 12px">`,
    `<!--[if mso]><table role="presentation" width="${w}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${w}px;background:${t.card};border-radius:8px">`,
    `<tr><td style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr>`,
    ...doc.blocks.map((b) => blockHtml(b, { ...t, width: w })),
    `<tr><td style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr>`,
    '</table>',
    '<!--[if mso]></td></tr></table><![endif]-->',
    '</td></tr></table></body></html>',
  ].join('\n')
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: 'Heading',
  text: 'Text',
  button: 'Button',
  image: 'Image',
  columns: 'Two columns',
  divider: 'Divider',
  spacer: 'Spacer',
  footer: 'Footer',
  event: 'Event / calendar',
}
