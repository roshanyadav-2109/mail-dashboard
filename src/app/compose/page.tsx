import { requireUser } from '@/lib/guard'

import Composer from './composer'

export default async function Compose({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  await requireUser()
  const { group } = await searchParams
  return <Composer initialGroup={group} />
}
