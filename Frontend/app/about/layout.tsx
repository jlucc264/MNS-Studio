import type { Metadata } from 'next'
import { pageMetadata } from '../../lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'About',
  description: 'MNS Studio is the online design studio from Mantoloking Needlepoint Shop — turn your own photos and artwork into printed needlepoint canvas, at true size, with real DMC thread colours.',
})

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
