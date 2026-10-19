export type TemplateBody = { name: string; category?: string; subject?: string; format?: 'html' | 'text'; html?: string; text?: string; blocks?: unknown }

/** Validates template fields before they are stored. */
export const cleanTemplate = (b: Partial<TemplateBody>) => ({
  ...(b.name !== undefined ? { name: String(b.name).trim().slice(0, 120) || 'Untitled template' } : {}),
  ...(b.category !== undefined ? { category: String(b.category).trim().slice(0, 60) || 'General' } : {}),
  ...(b.subject !== undefined ? { subject: String(b.subject).slice(0, 300) } : {}),
  ...(b.format !== undefined ? { format: b.format === 'text' ? 'text' : 'html' } : {}),
  ...(b.html !== undefined ? { html: String(b.html).slice(0, 500_000) } : {}),
  ...(b.text !== undefined ? { text: String(b.text).slice(0, 200_000) } : {}),
  ...(b.blocks !== undefined ? { blocks: b.blocks ?? null } : {}),
})

