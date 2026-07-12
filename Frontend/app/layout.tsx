import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '../components/AuthProvider'
import { Analytics } from '@vercel/analytics/next'

export const metadata: Metadata = {
  title: 'MNS Studio',
  description: 'Design needlepoint canvases from your photos — edit stitch by stitch, then order the printed canvas.',
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
        <AuthProvider>{children}</AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}
