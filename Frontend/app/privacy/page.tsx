'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CSSProperties, ReactNode } from 'react'
import { PublicPageNav } from '../../components/PublicPageNav'
import { useAuth } from '../../components/AuthProvider'
import { getMyCreatorProfile } from '../../lib/api'

const EFFECTIVE_DATE = 'June 2, 2026'

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

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#3f382f' }}>{title}</h3>
      {children}
    </div>
  )
}

const p: CSSProperties = { margin: '0 0 12px', fontSize: 14, color: '#5f574e', lineHeight: 1.75 }
const li: CSSProperties = { fontSize: 14, color: '#5f574e', lineHeight: 1.75, marginBottom: 6 }

export default function PrivacyPage() {
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
    <div style={{ minHeight: '100dvh', background: '#f5f1ea' }}>
      <PublicPageNav
        user={user}
        extraLink={{ href: '/terms', label: 'Terms' }}
        onProfile={() => void handleViewProfile()}
        onLogout={() => { void signOut() }}
        onStudio={() => router.push('/drafts')}
      />

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 32, color: '#3f382f' }}>Privacy Policy</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#8a8177' }}>Last updated: {EFFECTIVE_DATE}</p>
        </div>

        <div
          style={{
            background: '#fffdf8',
            border: '1px solid #e4ddd5',
            borderRadius: 12,
            padding: '36px 40px',
          }}
        >
          <Section title="1. Overview">
            <p style={p}>
              MNS Studio (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the MNS Studio platform, a
              needlepoint and cross-stitch design tool that allows users to create, customize, and submit designs for printing on
              physical canvas products. This Privacy Policy explains what information we collect, how we use it, and your rights
              regarding it.
            </p>
            <p style={p}>By using MNS Studio, you agree to the practices described in this Privacy Policy.</p>
          </Section>

          <Section title="2. Information We Collect">
            <Sub title="2.1 Information You Provide">
              <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                <li style={li}><strong>Account information:</strong> your name, email address, and password when you register</li>
                <li style={li}><strong>Payment information:</strong> payout details you provide to receive creator royalties. We do not store full payment account numbers directly — this is handled by Stripe</li>
                <li style={li}><strong>Designs and uploads:</strong> images, photos, and other content you upload or create within the Service</li>
                <li style={li}><strong>Communications:</strong> messages you send to us at <a href="mailto:john@mns.studio" style={{ color: '#6e8d67' }}>john@mns.studio</a></li>
              </ul>
            </Sub>
            <Sub title="2.2 Information Collected Automatically">
              <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                <li style={li}><strong>Usage data:</strong> pages visited, features used, time spent, and interactions within the Service</li>
                <li style={li}><strong>Device and browser information:</strong> IP address, browser type, operating system, and referring URLs</li>
                <li style={li}><strong>Cookies and similar technologies:</strong> see Section 6</li>
              </ul>
            </Sub>
            <Sub title="2.3 Information from Third Parties">
              <p style={p}>
                We use third-party services to operate the platform. Those services may process your data as described in
                Section 4.
              </p>
            </Sub>
          </Section>

          <Section title="3. How We Use Your Information">
            <p style={p}>We use your information to:</p>
            <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
              <li style={li}>Create and manage your account</li>
              <li style={li}>Provide, maintain, and improve the Service</li>
              <li style={li}>Process and fulfill marketplace orders and pay creator royalties</li>
              <li style={li}>Communicate with you about your account, orders, policy updates, and support requests</li>
              <li style={li}>Detect and prevent fraud, abuse, and violations of our Terms</li>
              <li style={li}>Comply with legal obligations</li>
              <li style={li}>Send you product updates or promotional communications (you can opt out at any time)</li>
            </ul>
            <p style={p}>We do not sell your personal information.</p>
          </Section>

          <Section title="4. How We Share Your Information">
            <Sub title="4.1 Service Providers">
              <p style={p}>
                We share information with third-party vendors who help us operate the Service, including:
              </p>
              <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                <li style={li}><strong>Cloud storage and database:</strong> to store your account data and designs</li>
                <li style={li}><strong>AI providers:</strong> your design inputs are processed by AI services (including Anthropic and OpenAI) to generate design outputs. These providers process data under their own privacy policies and are not permitted to use your data to train their models based on our agreements with them</li>
                <li style={li}><strong>Payment processors:</strong> creator royalty payouts are processed by Stripe, Inc. Stripe may collect and process payment account information directly. See <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#6e8d67' }}>Stripe&rsquo;s Privacy Policy</a> for details</li>
                <li style={li}><strong>Hosting and infrastructure:</strong> to deliver the Service reliably</li>
              </ul>
              <p style={p}>
                We require all service providers to handle your data in a manner consistent with this Privacy Policy.
              </p>
            </Sub>
            <Sub title="4.2 Legal Requirements">
              <p style={p}>
                We may disclose your information if required to do so by law, court order, or government authority, or if we
                believe disclosure is necessary to protect the rights, property, or safety of MNS Studio, our users, or the
                public.
              </p>
            </Sub>
            <Sub title="4.3 Business Transfers">
              <p style={p}>
                If MNS Studio is involved in a merger, acquisition, or sale of assets, your information may be transferred as
                part of that transaction. We will notify you before your information becomes subject to a materially different
                privacy policy.
              </p>
            </Sub>
            <Sub title="4.4 With Your Consent">
              <p style={p}>We may share your information for other purposes with your explicit consent.</p>
            </Sub>
          </Section>

          <Section title="5. Data Retention">
            <p style={p}>
              We retain your account information and designs for as long as your account is active. If you delete your account,
              we will delete or anonymize your personal information within a reasonable time, except:
            </p>
            <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
              <li style={li}>Where we are required to retain it by law</li>
              <li style={li}>Where it is associated with completed orders or outstanding royalty payments</li>
              <li style={li}>Where it has been shared with third parties as part of a completed transaction</li>
            </ul>
          </Section>

          <Section title="6. Cookies">
            <p style={p}>
              We use cookies and similar tracking technologies to keep you logged in, remember your preferences, and understand
              how the Service is used. You can control cookies through your browser settings, though disabling them may affect
              some functionality of the Service.
            </p>
            <p style={p}>We do not use cookies for third-party advertising.</p>
          </Section>

          <Section title="7. Your Rights">
            <Sub title="7.1 All Users">
              <p style={p}>You may:</p>
              <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                <li style={li}>Access, correct, or update your account information at any time through your account settings</li>
                <li style={li}>Request deletion of your account and associated personal data by contacting <a href="mailto:john@mns.studio" style={{ color: '#6e8d67' }}>john@mns.studio</a></li>
                <li style={li}>Opt out of promotional emails by clicking &ldquo;unsubscribe&rdquo; in any email or contacting us directly</li>
              </ul>
            </Sub>
            <Sub title="7.2 California Residents (CCPA)">
              <p style={p}>If you are a California resident, you have the right to:</p>
              <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                <li style={li}>Know what personal information we collect, use, disclose, or sell</li>
                <li style={li}>Request deletion of your personal information (subject to certain exceptions)</li>
                <li style={li}>Non-discrimination for exercising your privacy rights</li>
              </ul>
              <p style={p}>
                We do not sell personal information as defined under the CCPA. To exercise these rights, contact us at{' '}
                <a href="mailto:john@mns.studio" style={{ color: '#6e8d67' }}>john@mns.studio</a>.
              </p>
            </Sub>
            <Sub title="7.3 EEA and UK Residents (GDPR)">
              <p style={p}>If you are located in the European Economic Area or United Kingdom, you have the right to:</p>
              <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                <li style={li}>Access your personal data</li>
                <li style={li}>Correct inaccurate data</li>
                <li style={li}>Request erasure of your data (&ldquo;right to be forgotten&rdquo;)</li>
                <li style={li}>Restrict or object to processing of your data</li>
                <li style={li}>Data portability</li>
                <li style={li}>Lodge a complaint with your local data protection authority</li>
              </ul>
              <p style={p}>
                Our legal basis for processing is primarily contract performance (operating your account and the Service) and
                legitimate interests (security, fraud prevention, Service improvement). Where we send marketing communications,
                we rely on your consent. To exercise your rights, contact us at{' '}
                <a href="mailto:john@mns.studio" style={{ color: '#6e8d67' }}>john@mns.studio</a>.
              </p>
            </Sub>
          </Section>

          <Section title="8. Data Security">
            <p style={p}>
              We implement industry-standard technical and organizational measures to protect your information against
              unauthorized access, loss, or alteration. However, no method of transmission or storage is completely secure, and
              we cannot guarantee absolute security.
            </p>
          </Section>

          <Section title="9. Children's Privacy">
            <p style={p}>
              The Service is not directed to children under 18. We do not knowingly collect personal information from anyone
              under 18. If we learn we have done so, we will delete it promptly.
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p style={p}>
              We may update this Privacy Policy from time to time. When we do, we will post the revised Policy with an updated
              date and notify you via email or in-app notice. Your continued use of the Service after the effective date
              constitutes acceptance of the updated Policy.
            </p>
          </Section>

          <Section title="11. Contact">
            <p style={{ ...p, marginBottom: 0 }}>
              For questions, requests, or concerns about this Privacy Policy, contact us at:{' '}
              <a href="mailto:john@mns.studio" style={{ color: '#6e8d67', fontWeight: 600 }}>john@mns.studio</a>
            </p>
          </Section>
        </div>

        <p style={{ marginTop: 24, fontSize: 13, color: '#8a8177', textAlign: 'center' }}>
          Also see our{' '}
          <Link href="/terms" style={{ color: '#6e8d67' }}>Terms and Conditions</Link>
        </p>
      </main>
    </div>
  )
}
