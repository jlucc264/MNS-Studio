import type { Metadata } from 'next'
import { pageMetadata } from '../../lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Your Studio',
  description: 'Your saved MNS Studio designs.',
  noIndex: true,
})

export default function DraftsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
