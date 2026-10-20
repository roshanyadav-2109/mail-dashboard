import { revalidatePath } from 'next/cache'

import { db } from '@/lib/db'
import { parseEmails } from '@/lib/emails'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'
import { reportRecipients, sendWeeklyReport } from '@/lib/report'
import { getSettings, saveSettings } from '@/lib/settings'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const Status = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span>
    <span className={`dot ${ok ? 'ok' : 'no'}`} />
    {children}
  </span>
)

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const me = await requireRole('viewer')
  const { saved } = await searchParams
  const canEdit = atLeast(me.role, 'admin')
  const s = await getSettings()
  const recipients = await reportRecipients()
  const { data: last } = await db().from('ses_events').select('created_at, event_type').order('created_at', { ascending: false }).limit(1)
  const lastEvent = last?.[0] as { created_at: string; event_type: string } | undefined
  const address = (process.env.SES_FROM ?? '').match(/<([^>]+)>/)?.[1] ?? process.env.SES_FROM ?? ''

  return (
    <>
      <PageHead title="Settings" />
      {saved && <div className="notice good-notice" style={{ marginBottom: 14 }}>{saved === 'report' ? 'Weekly report sent.' : 'Settings saved.'}</div>}
      {canEdit && (
        <form
          style={{ marginBottom: 14 }}
          action={async () => {
            'use server'
            await requireRole('admin')
            await sendWeeklyReport()
            const { redirect } = await import('next/navigation')
            redirect('/settings?saved=report')
          }}
        >
          <button className="ghost" type="submit">
            Send this week’s report now
          </button>
        </form>
      )}

      <form
        className="card"
        action={async (form) => {
          'use server'
          const actor = await requireRole('admin')
          const replyTo = String(form.get('reply_to') ?? '').trim().toLowerCase()
          const daily = Math.max(1, Math.min(50000, Number(form.get('daily_limit')) || 1))
          const threshold = Math.max(1, Number(form.get('approval_threshold')) || 1)
          await saveSettings(
            {
              sender_name: String(form.get('sender_name') ?? '').trim().slice(0, 80) || 'Unknown IITians',
              reply_to: EMAIL.test(replyTo) ? replyTo : '',
              daily_limit: daily,
              approval_enabled: form.get('approval_enabled') === 'on',
              approval_threshold: threshold,
              test_recipients: parseEmails(String(form.get('test_recipients') ?? '')).slice(0, 10),
              weekly_report: form.get('weekly_report') === 'on',
              weekly_report_to: parseEmails(String(form.get('weekly_report_to') ?? '')).slice(0, 20),
            },
            actor.email,
          )
          revalidatePath('/settings')
          const { redirect } = await import('next/navigation')
          redirect('/settings?saved=1')
        }}
      >
        <div className="card-head">
          <h2>Sending</h2>
          {canEdit && <button type="submit">Save changes</button>}
        </div>
        <fieldset disabled={!canEdit} className="card-body settings-grid">
          <label>
            Sender name
            <input name="sender_name" defaultValue={s.sender_name} />
          </label>
          <label>
            Sender address
            <input value={address} readOnly aria-readonly title="Fixed to unknowniitians.in" />
          </label>
          <label>
            Default reply-to
            <input name="reply_to" type="email" defaultValue={s.reply_to} placeholder="Replies go to the sender address" />
          </label>
          <label>
            Daily send limit
            <input name="daily_limit" type="number" min={1} max={50000} defaultValue={s.daily_limit} />
          </label>
          <label className="check">
            <input name="approval_enabled" type="checkbox" defaultChecked={s.approval_enabled} />
            Large sends need a second admin&apos;s approval
          </label>
          <label>
            Approval needed above (recipients)
            <input name="approval_threshold" type="number" min={1} defaultValue={s.approval_threshold} />
          </label>
          <label className="check">
            <input name="weekly_report" type="checkbox" defaultChecked={s.weekly_report} />
            Email a weekly report every Monday, 9 am
          </label>
          <label>
            Weekly report goes to
            <input name="weekly_report_to" defaultValue={s.weekly_report_to.join(', ')} placeholder={`All admins (${recipients.join(', ')})`} />
          </label>
          <label className="span-all">
            Default test recipients
            <input name="test_recipients" defaultValue={s.test_recipients.join(', ')} placeholder="Comma-separated, up to 10" />
          </label>
        </fieldset>

        <div className="card-head" style={{ borderTop: '1px solid var(--line)' }}>
          <h2>System</h2>
        </div>
        <div className="card-body">
          <div className="kv">
            <div className="k">AWS region</div>
            <div>{process.env.AWS_REGION ?? '—'}</div>
            <div className="k">Configuration set</div>
            <div>{process.env.SES_CONFIGURATION_SET || '—'}</div>
            <div className="k">AWS credentials</div>
            <div>
              <Status ok={!!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY}>
                {process.env.AWS_ACCESS_KEY_ID ? 'Configured' : 'Missing'}
              </Status>
            </div>
            <div className="k">Last delivery event</div>
            <div>
              <Status ok={!!lastEvent}>{lastEvent ? `${lastEvent.event_type} · ${new Date(lastEvent.created_at).toLocaleString('en-IN')}` : 'None yet'}</Status>
            </div>
            <div className="k">Scheduled sending</div>
            <div>
              <Status ok={!!process.env.CRON_SECRET}>{process.env.CRON_SECRET ? 'Enabled' : 'CRON_SECRET is not set'}</Status>
            </div>
          </div>
        </div>
      </form>
    </>
  )
}
