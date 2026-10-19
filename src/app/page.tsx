import { requireUser } from '@/lib/guard'

import Composer from './composer'

export default async function Home() {
  await requireUser()
  return (
    <main>
      <Composer />
    </main>
  )
}
