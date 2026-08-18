import type { Metadata } from 'next'
import { pageMetadata } from '../../lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Tips & Tricks',
  description: 'How to get a needlepoint canvas you’ll actually enjoy stitching — image prep, colour count, mesh and size, and using the editor tools.',
})

export default function TipsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
