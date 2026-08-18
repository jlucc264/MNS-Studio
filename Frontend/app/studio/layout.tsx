import type { Metadata } from 'next'
import { pageMetadata } from '../../lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Design Studio',
  description: 'Turn a photo into a needlepoint pattern: upload, set size and mesh, pick your colours, and order it printed on canvas.',
})

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
