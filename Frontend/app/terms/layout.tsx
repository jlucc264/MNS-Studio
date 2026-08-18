import type { Metadata } from 'next'
import { pageMetadata } from '../../lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Terms and Conditions',
  description: 'The terms and conditions for ordering, designing, and selling through MNS Studio.',
})

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
