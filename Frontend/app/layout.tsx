import { AuthProvider } from '../components/AuthProvider'

export const metadata = {
  title: 'MNS Studio',
  description: 'MNS Studio',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: 'Georgia, "Times New Roman", serif',
          color: '#3f382f',
          background: '#f5f1ea',
        }}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
