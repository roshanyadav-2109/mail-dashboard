import { requireUser } from '@/lib/guard'

import PageHead from '../page-head'
import Composer from './composer'

export default async function Compose() {
  await requireUser()
  return (
    <>
      <PageHead
        title="Compose"
        description="Write an HTML email, choose recipients and send. Sent from mail@unknowniitians.in."
        crumbs={[{ href: '/', name: 'Overview' }, { name: 'Compose' }]}
      />
      <Composer />
    </>
  )
}
