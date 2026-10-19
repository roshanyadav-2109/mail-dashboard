import { requireUser } from '@/lib/guard'

import PageHead from '../page-head'
import Composer from './composer'

export default async function Compose({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  await requireUser()
  const { group } = await searchParams
  return (
    <>
      <PageHead
        title="Compose"
        description="Pick groups, write an HTML or plain-text email and send. Sent from mail@unknowniitians.in."
        crumbs={[{ href: '/', name: 'Account home' }, { name: 'Compose' }]}
      />
      <Composer initialGroup={group} />
    </>
  )
}
