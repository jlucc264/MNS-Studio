'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CSSProperties, ReactNode } from 'react'
import { NavAccountControls } from '../../components/NavAccountControls'
import { useAuth } from '../../components/AuthProvider'
import {
  getMyCreatorProfile,
  BELT_MAX_LENGTH_IN,
  BELT_MIN_LENGTH_IN,
  GALLERY_MARKUP,
  STANDARD_MAX_LONG_SIDE,
  STANDARD_MAX_SHORT_SIDE,
} from '../../lib/api'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 20, color: '#3f382f', borderBottom: '1px solid #e4ddd5', paddingBottom: 10 }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

const p: CSSProperties = { margin: '0 0 12px', fontSize: 14, color: '#5f574e', lineHeight: 1.75 }
const li: CSSProperties = { fontSize: 14, color: '#5f574e', lineHeight: 1.75, marginBottom: 6 }

export default function AboutPage() {
  const router = useRouter()
  const { session, user, signOut } = useAuth()

  async function handleViewProfile() {
    if (!session?.access_token) return
    try {
      const profile = await getMyCreatorProfile(session.access_token)
      router.push(profile.slug ? `/gallery/${profile.slug}` : '/gallery')
    } catch {
      router.push('/gallery')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f1ea' }}>
      <nav
        style={{
          height: 70,
          display: 'flex',
          alignItems: 'center',
          padding: '0 28px',
          justifyContent: 'space-between',
          borderBottom: '1px solid #5c7856',
          background: '#6e8d67',
          boxSizing: 'border-box',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Link href="/gallery" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', flexShrink: 0 }}>
            <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 3, padding: 2 }}>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ width: 9, height: 9, border: '2px solid #fffdf8', borderRadius: 2, boxSizing: 'border-box' }} />
              ))}
            </div>
            <strong style={{ fontSize: 22, color: '#fffdf8' }}>MNS Studio</strong>
          </Link>
          <span style={{ color: 'rgba(255,255,255,0.5)', margin: '0 6px' }}>|</span>
          <div style={{ display: 'flex', gap: 24, color: '#fffdf8', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <Link href="/gallery" style={{ color: 'rgba(255,255,255,0.86)', textDecoration: 'none' }}>Gallery</Link>
            <Link href="/drafts" style={{ color: 'rgba(255,255,255,0.86)', textDecoration: 'none' }}>Your Studio</Link>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
          <NavAccountControls
            user={user}
            onProfile={() => void handleViewProfile()}
            onLogout={() => { void signOut() }}
            onStudio={() => router.push('/studio')}
          />
        </div>
      </nav>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 32, color: '#3f382f' }}>About MNS Studio</h1>
          <p style={{ margin: 0, fontSize: 14, color: '#8a8177' }}>
            Design your own needlepoint canvas, and we&rsquo;ll print it.
          </p>
        </div>

        <div
          style={{
            background: '#fffdf8',
            border: '1px solid #e4ddd5',
            borderRadius: 12,
            padding: '36px 40px',
          }}
        >
          <Section title="Our Story">
            <p style={p}>
              Hi! Thanks for coming to our website. We are the Mantoloking Needlepoint Shop, and
              welcome to our online studio.
            </p>
            <p style={p}>
              I created this studio because I want to make needlepoint more affordable, and to give
              people the power to design what they want. Needlepoint is stitched by people young and
              old. It&rsquo;s a craft that lets us take time away from our phones and create something
              we want to share with the world, and it fosters an incredible community of people who
              are born to be creative at every step of the process — whether that&rsquo;s designing,
              stitching, or finishing. I want nothing more than to help it grow in any way I can.
            </p>
            <p style={p}>
              I was inspired to create this site after watching my girlfriend make a framed stitch as
              a wedding gift for her sister. She wanted to stitch the church her sister was getting
              married at, but no one had a design online. So she bought canvas and paint and spent
              months charting the design — and only then was she finally able to start stitching what
              she actually wanted. My goal with this site is to help get something you want into your
              hands as fast as possible, and for as cheap as possible.
            </p>
          </Section>

          <Section title="What to Expect">
            <p style={p}>
              I need to make clear that I don&rsquo;t intend to take away from the people who hand-paint
              or professionally design canvases. They are really good at what they do, and they command
              the price they ask for a reason.
            </p>
            <p style={p}>
              While I strive for the highest quality, I am by no means stitch perfect.{' '}
              <strong style={{ color: '#3f382f' }}>
                These will not be as exact as hand-painted designs.
              </strong>{' '}
              So, in addition to every canvas print we provide a stitch guide and the list of
              threads you&rsquo;ll need to help get you through it.
            </p>
            <div
              style={{
                background: '#f0f4ee',
                border: '1px solid #cfdcc9',
                borderRadius: 10,
                padding: '16px 18px',
                marginTop: 18,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: '#4a7244', marginBottom: 6 }}>
                Our guarantee
              </div>
              <p style={{ ...p, marginBottom: 0 }}>
                If you have any issues with our prints, we will refund you the price of the canvas and
                you can keep the design. Tell us within 30 days of delivery — the full details are in{' '}
                <Link href="/terms" style={{ color: '#6e8d67', fontWeight: 600 }}>our terms</Link>.
              </p>
            </div>
          </Section>

          <Section title="What We Do">
            <p style={p}>
              MNS Studio turns your own artwork into a printed needlepoint canvas. Start from a
              photograph, draw from scratch on a blank grid, or begin with a design someone else
              has shared in the gallery. The editor converts what you make into stitches, matches
              every colour to a real DMC thread, and shows you the finished piece before you
              commit to anything.
            </p>
            <p style={p}>
              When you order, we print your design at true size onto canvas and ship it to you
              ready to stitch, along with a PDF report listing every thread colour used and how
              much of each you&rsquo;ll need.
            </p>
          </Section>

          <Section title="The Canvas">
            <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
              <li style={li}>
                <strong>Zweigart Mono Deluxe</strong> — the same canvas used for hand-painted
                needlepoint, printed to order rather than held in stock.
              </li>
              <li style={li}>
                <strong>13 or 18 mesh</strong>, so you can choose between faster coverage and
                finer detail.
              </li>
              <li style={li}>
                <strong>A 2&Prime; margin on every side</strong>, left unstitched so there is
                canvas to grip when you block and frame the finished piece.
              </li>
              <li style={li}>
                <strong>Belts</strong> from {BELT_MIN_LENGTH_IN}&Prime; to {BELT_MAX_LENGTH_IN}&Prime;,
                sized to your waist rather than to a stock length.
              </li>
            </ul>
            <p style={p}>
              Designs up to {STANDARD_MAX_LONG_SIDE}&Prime; &times; {STANDARD_MAX_SHORT_SIDE}&Prime;
              order directly through the site. Anything larger we print too — get in touch and
              we&rsquo;ll quote it, since bigger pieces ship differently.
            </p>
          </Section>

          <Section title="For Designers">
            <p style={p}>
              Anything you make is yours. If you publish a design to the gallery, other stitchers
              can order it printed, and you earn {Math.round(GALLERY_MARKUP * 100)}% of the base
              print price every time someone does. That earning arrives as canvas credit you can spend
              on your next order.
            </p>
            <p style={p}>
              The {Math.round(GALLERY_MARKUP * 100)}% is funded by the buyer, not taken out of
              your work — a gallery print costs exactly that much more than printing a design you
              made yourself, and the difference goes to you.
            </p>
          </Section>

          <Section title="Get In Touch">
            <p style={p}>
              Questions about an order, a large print, or anything else — just{' '}
              <Link href="/contact" style={{ color: '#6e8d67', fontWeight: 600 }}>contact us</Link>.
              Don&rsquo;t hesitate to reach out if you find any bugs or have any questions.
            </p>
            <p style={{ ...p, marginBottom: 0 }}>
              Enjoy the site, and have fun designing!
            </p>
          </Section>
        </div>

        <p style={{ marginTop: 24, fontSize: 13, color: '#8a8177', textAlign: 'center' }}>
          <Link href="/gallery" style={{ color: '#6e8d67' }}>Browse the gallery</Link>
          {' · '}
          <Link href="/studio" style={{ color: '#6e8d67' }}>Start a design</Link>
        </p>
      </main>
    </div>
  )
}
