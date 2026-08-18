import type { Metadata } from 'next'
import { pageMetadata } from '../../lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Contact',
  description: 'Questions about an order, a large print, or a design you’re working on — get in touch with MNS Studio.',
})

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
