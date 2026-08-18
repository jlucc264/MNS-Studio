import type { Metadata } from 'next'
import { pageMetadata } from '../../lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Gallery',
  description: 'Browse needlepoint designs shared by other stitchers, order a print, or use one as a template to start your own.',
})

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
