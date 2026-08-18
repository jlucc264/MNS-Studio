import type { Metadata } from 'next'
import { pageMetadata } from '../../lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Privacy Policy',
  description: 'How MNS Studio collects, uses, and protects your information.',
})

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
