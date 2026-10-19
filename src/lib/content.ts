// The editable body of an email, shared by the composer and the template editor. Browser-safe.
import { blocksToHtml, defaultDoc, type Doc } from '@/lib/blocks'

export type Format = 'html' | 'text'

export type Content = {
  subject: string
  /** Inbox preview text shown after the subject (HTML emails only). */
  preheader: string
  format: Format
  html: string
  text: string
  /** Visual-builder document. When set (and format is html), `html` is generated from it. */
  blocks: Doc | null
}

export function newContent(): Content {
  const doc = defaultDoc()
  return { subject: '', preheader: '', format: 'html', html: blocksToHtml(doc), text: '', blocks: doc }
}

/** The body that will actually be sent for the chosen format. */
export const bodyOf = (c: Pick<Content, 'format' | 'html' | 'text'>) => (c.format === 'text' ? c.text : c.html)

/** Readable plain-text version of an HTML email (for the text part and for switching to plain text). */
export const toText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      return /^https?:/i.test(href) && text && !text.includes(href) ? `${text} (${href})` : text
    })
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h\d>|<\/tr>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()

/** Hidden inbox preview text, placed first in the body. */
export const withPreheader = (html: string, preheader: string) => {
  if (!preheader.trim()) return html
  const span = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${preheader.replace(/</g, '&lt;')}${'&#847; &zwnj; &nbsp; '.repeat(20)}</div>`
  return /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + span) : span + html
}
