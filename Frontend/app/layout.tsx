import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '../components/AuthProvider'
import { Analytics } from '@vercel/analytics/next'

const SITE_DESCRIPTION = 'MNS Studio, by Mantoloking Needlepoint Shop — design needlepoint canvases from your photos and order them printed.'

// Tells Google "MNS Studio" (the product) and "Mantoloking Needlepoint Shop"
// (the business) are the same entity, so a search for either name can surface
// this site. No address/LocalBusiness fields — the shop is online-only.
const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Mantoloking Needlepoint Shop',
  alternateName: 'MNS Studio',
  url: 'https://www.mns.studio',
  logo: 'https://www.mns.studio/icons/icon-512.png',
  description: SITE_DESCRIPTION,
}

export const metadata: Metadata = {
  metadataBase: new URL('https://www.mns.studio'),
  title: {
    default: 'MNS Studio',
    template: '%s — MNS Studio',
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    siteName: 'MNS Studio',
    title: 'MNS Studio',
    description: SITE_DESCRIPTION,
    images: ['/icons/icon-512.png'],
  },
  twitter: {
    card: 'summary',
    title: 'MNS Studio',
    description: SITE_DESCRIPTION,
    images: ['/icons/icon-512.png'],
  },
  appleWebApp: {
    capable: true,
    title: 'MNS Studio',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f5f1ea',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'Georgia, "Times New Roman", serif',
          color: '#3f382f',
          background: '#f5f1ea',
        }}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
        />
        <AuthProvider>{children}</AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}
