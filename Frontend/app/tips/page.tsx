'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CSSProperties, ReactNode } from 'react'
import { NavAccountControls } from '../../components/NavAccountControls'
import { useAuth } from '../../components/AuthProvider'
import { getMyCreatorProfile } from '../../lib/api'

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
const shot: CSSProperties = {
  width: '100%',
  maxWidth: 340,
  display: 'block',
  margin: '4px 0 14px',
  borderRadius: 10,
  border: '1px solid #e4ddd5',
}

export default function TipsPage() {
  const router = useRouter()
  const { user, session, signOut } = useAuth()

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
          <h1 style={{ margin: '0 0 8px', fontSize: 32, color: '#3f382f' }}>Tips &amp; Tricks</h1>
          <p style={{ margin: 0, fontSize: 14, color: '#8a8177' }}>
            Creating a design can be intimidating, so hopefully these tips will help you get where
            you need to be.
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
          <Section title="1. Bring Your Colour Count Down Early">
            <img src="/tips/design-palette-slider.png" alt="The Design step, showing the Reduce current palette slider" style={shot} />
            <p style={p}>
              When you import a photo, the editor tries to recreate it in as much detail as it can
              — which usually means a lot of stitch colours, and a lot of them very close in shade.
              Use the <strong>Reduce current palette</strong> slider to bring that count down into
              roughly the <strong>8&ndash;20 range</strong> first, then fine-tune from there with the
              Select and Fill tools below.
            </p>
            <p style={{ ...p, marginBottom: 0 }}>
              If you&rsquo;re starting from a photo rather than clip art, MNS Pro (our chatbot) or
              Canva can help you generate something more stitch-friendly before you upload it.
            </p>
          </Section>

          <Section title="2. Chasing Detail? There&rsquo;s More Than One Lever">
            <img src="/tips/design-size-settings.png" alt="The Size and Settings panel, with Source Type, Import Width/Height, Mesh, and Contrast" style={shot} />
            <p style={{ ...p, marginBottom: 0 }}>
              If your import isn&rsquo;t as detailed as you&rsquo;d like, the fix is usually either
              importing the photo <strong>larger</strong>, or switching to <strong>18 mesh</strong>.
              Anything that adds resolution helps. It&rsquo;s also worth playing with{' '}
              <strong>Contrast</strong> and the <strong>Graphic</strong> source setting to see if you
              can get the image to pop.
            </p>
          </Section>

          <Section title="3. Select and Fill: Two Ways to Cut Colours">
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <img src="/tips/select-color-panel.png" alt="Select tab, Color sub-tab, highlighting a colour to replace it across the design" style={{ ...shot, maxWidth: 260 }} />
              <img src="/tips/create-fill-panel.png" alt="Create tab, Fill sub-tab, clicking a region to fill it with the active colour" style={{ ...shot, maxWidth: 260 }} />
            </div>
            <p style={{ ...p, marginBottom: 0 }}>
              Both tools are great for reducing colours, and they work differently.{' '}
              <strong>Select &rarr; Color</strong> lets you select every cell of one colour at once
              and replace them all in a single move. <strong>Create &rarr; Fill</strong> lets you
              click on a specific section and fill it with whatever colour is active.
            </p>
          </Section>

          <Section title="4. Use Trace to Check Your Progress">
            <img src="/tips/trace-preview.png" alt="The stitched preview with the Trace slider in the top right" style={shot} />
            <p style={{ ...p, marginBottom: 0 }}>
              The <strong>Trace</strong> slider, top right of the canvas, is probably the tool we
              use the most when designing from an import. Slide it back and forth to fade between
              your original source image and your work in progress, so you can see exactly where
              your stitches are drifting from the source.
            </p>
          </Section>

          <Section title="5. Cut, Copy, and Paste for Symmetry">
            <img src="/tips/cut-paste-panel.png" alt="Select tab, Cut / Paste sub-tab, with Rotate, Flip H, Flip V, and directional controls" style={shot} />
            <p style={{ ...p, marginBottom: 0 }}>
              The <strong>Cut / Paste</strong> tool is a big help for symmetrical designs. Select a
              region, then flip it horizontally or vertically, rotate it, or just nudge it into
              place with the arrows before committing with <strong>Place</strong>.
            </p>
          </Section>

          <Section title="6. Imitation Is the Sincerest Form of Flattery">
            <img src="/tips/gallery-template.png" alt="A gallery design page with the Use template button" style={shot} />
            <p style={{ ...p, marginBottom: 0 }}>
              Don&rsquo;t be afraid to use someone else&rsquo;s shared design as a template to get
              where you want to go — hit <strong>Use template</strong> on any gallery design to
              start from it. The whole point of the gallery is to design and share with each other.
            </p>
          </Section>
        </div>

        <p style={{ marginTop: 24, fontSize: 13, color: '#8a8177', textAlign: 'center' }}>
          Hope this helps &mdash; don&rsquo;t hesitate to{' '}
          <Link href="/contact" style={{ color: '#6e8d67' }}>reach out</Link> if you have questions.
        </p>
        <p style={{ marginTop: 8, fontSize: 13, color: '#8a8177', textAlign: 'center' }}>
          <Link href="/studio" style={{ color: '#6e8d67' }}>Start a design</Link>
          {' · '}
          <Link href="/gallery" style={{ color: '#6e8d67' }}>Browse the gallery</Link>
        </p>
      </main>
    </div>
  )
}
