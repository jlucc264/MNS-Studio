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
      <body
        style={{
          margin: 0,
          fontFamily: 'Georgia, "Times New Roman", serif',
          color: '#3f382f',
          background: '#f5f1ea',
        }}
      >
        {children}
      </body>
    </html>
  )
}
