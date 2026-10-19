import { db } from '@/lib/db'
import { requireUser } from '@/lib/guard'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

const Status = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span>
    <span className={`dot ${ok ? 'ok' : 'no'}`} />
    {children}
  </span>
)

export default async function Settings() {
  const me = await requireUser()
  const sb = db()
  const { data: last } = await sb.from('ses_events').select('created_at, event_type').order('created_at', { ascending: false }).limit(1)
  const allowedUsers = (process.env.ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean)
  const from = process.env.SES_FROM ?? ''
  const lastEvent = last?.[0] as { created_at: string; event_type: string } | undefined

  return (
    <>
      <PageHead title="Settings" description="Read-only configuration. Change these in the Vercel project's environment variables." crumbs={[{ href: '/', name: 'Overview' }, { name: 'Settings' }]} />

      <div className="stack">
        <div className="card">
          <div className="card-head">
            <h2>Sending</h2>
          </div>
          <div className="card-body">
            <div className="kv">
              <div className="k">Sender address</div>
              <div>{from || '—'}</div>
              <div className="k">Allowed sender domain</div>
              <div>unknowniitians.in (the app refuses any other)</div>
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
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Delivery tracking</h2>
          </div>
          <div className="card-body">
            <div className="kv">
              <div className="k">Webhook endpoint</div>
              <div>{(process.env.APP_URL ?? '') + '/api/ses/events'}</div>
              <div className="k">SNS topic</div>
              <div>{process.env.SNS_TOPIC_ARN || '—'}</div>
              <div className="k">Last event received</div>
              <div>
                <Status ok={!!lastEvent}>
                  {lastEvent ? `${lastEvent.event_type} at ${new Date(lastEvent.created_at).toLocaleString('en-IN')}` : 'None yet'}
                </Status>
              </div>
              <div className="k">Unsubscribe links</div>
              <div>
                <Status ok={!!process.env.APP_URL}>{process.env.APP_URL ? 'Enabled' : 'APP_URL is not set'}</Status>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Access ({allowedUsers.length})</h2>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Google account</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {allowedUsers.map((u) => (
                  <tr key={u}>
                    <td>
                      {u} {u.toLowerCase() === me.toLowerCase() && <span className="badge sent">you</span>}
                    </td>
                    <td>Administrator</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
