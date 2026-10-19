import { db } from '@/lib/db'
import { blocksToHtml, DEFAULT_THEME, uid, type Doc } from '@/lib/blocks'

type Starter = { name: string; category: string; subject: string; format: 'html' | 'text'; blocks?: Doc; text?: string }

const doc = (blocks: Doc['blocks'], theme: Partial<Doc['theme']> = {}): Doc => ({ theme: { ...DEFAULT_THEME, ...theme }, blocks })

const STARTERS: Starter[] = [
  {
    name: 'Newsletter',
    category: 'Newsletter',
    subject: 'This month at Unknown IITians',
    format: 'html',
    blocks: doc([
      { id: uid(), type: 'heading', text: 'This month at Unknown IITians', size: 'lg', align: 'left' },
      { id: uid(), type: 'text', text: 'Hi {{first_name|there}},\n\nHere’s a quick roundup of what happened this month and what’s coming next.', align: 'left' },
      { id: uid(), type: 'image', src: 'https://placehold.co/1200x560/f6821f/ffffff/png?text=Feature+image', alt: 'Feature image', href: '', width: 600, align: 'center' },
      { id: uid(), type: 'heading', text: 'Highlights', size: 'md', align: 'left' },
      { id: uid(), type: 'text', text: '**Mock tests are live.** Practise with timed papers for every subject.\n\n**New study notes.** Week-wise notes are now on the website.', align: 'left' },
      { id: uid(), type: 'button', label: 'Read more', url: 'https://unknowniitians.in', align: 'left' },
      { id: uid(), type: 'divider' },
      { id: uid(), type: 'columns', left: '**Upcoming**\nDoubt-clearing session, Saturday 6 pm.', right: '**Tip of the month**\nRevise one week every day before the quiz.' },
      { id: uid(), type: 'footer', text: 'Unknown IITians · unknowniitians.in' },
    ]),
  },
  {
    name: 'Announcement',
    category: 'Announcement',
    subject: 'Big news: {{first_name|there}}, something new is here',
    format: 'html',
    blocks: doc(
      [
        { id: uid(), type: 'spacer', height: 16 },
        { id: uid(), type: 'heading', text: 'Something new is here', size: 'lg', align: 'center' },
        { id: uid(), type: 'text', text: 'We’ve just launched a feature many of you asked for. Here’s what it means for you.', align: 'center' },
        { id: uid(), type: 'button', label: 'See what’s new', url: 'https://unknowniitians.in', align: 'center' },
        { id: uid(), type: 'spacer', height: 16 },
        { id: uid(), type: 'footer', text: 'Unknown IITians · unknowniitians.in' },
      ],
      { accent: '#0051c3' },
    ),
  },
  {
    name: 'Event reminder',
    category: 'Reminder',
    subject: 'Reminder: session tomorrow',
    format: 'html',
    blocks: doc([
      { id: uid(), type: 'heading', text: 'See you tomorrow, {{first_name|there}}', size: 'lg', align: 'left' },
      { id: uid(), type: 'text', text: 'This is a reminder that the live session is tomorrow. Join a few minutes early.', align: 'left' },
      { id: uid(), type: 'columns', left: '**When**\nSaturday, 6:00 pm IST', right: '**Where**\nOnline — link below' },
      { id: uid(), type: 'button', label: 'Join the session', url: 'https://unknowniitians.in', align: 'left' },
      { id: uid(), type: 'footer', text: 'Can’t make it? Just reply to this email.' },
    ]),
  },
  {
    name: 'Welcome',
    category: 'Onboarding',
    subject: 'Welcome to Unknown IITians, {{first_name|there}}!',
    format: 'html',
    blocks: doc([
      { id: uid(), type: 'heading', text: 'Welcome aboard, {{first_name|there}}!', size: 'lg', align: 'left' },
      { id: uid(), type: 'text', text: 'Thanks for joining. Here are three things to do first:\n\n1. Explore the study notes\n2. Try a mock test\n3. Join the community group', align: 'left' },
      { id: uid(), type: 'button', label: 'Get started', url: 'https://unknowniitians.in', align: 'left' },
      { id: uid(), type: 'footer', text: 'Questions? Reply to this email — a real person reads it.' },
    ]),
  },
  {
    name: 'Simple note',
    category: 'Plain text',
    subject: 'A quick note',
    format: 'text',
    text: 'Hi {{first_name|there}},\n\nJust a quick note to let you know …\n\nThanks,\nUnknown IITians',
  },
]

/** Adds the starter templates once, the first time the Templates page is opened. */
export async function ensureStarters() {
  const sb = db()
  const { count } = await sb.from('templates').select('id', { count: 'exact', head: true }).eq('is_starter', true)
  if (count) return
  await sb.from('templates').insert(
    STARTERS.map((s) => ({
      name: s.name,
      category: s.category,
      subject: s.subject,
      format: s.format,
      html: s.format === 'html' && s.blocks ? blocksToHtml(s.blocks) : (s.text ?? ''),
      blocks: s.blocks ?? null,
      is_starter: true,
      created_by: 'system',
    })),
  )
}
