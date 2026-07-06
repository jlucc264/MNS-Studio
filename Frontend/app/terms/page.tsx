import Link from 'next/link'

const EFFECTIVE_DATE = 'June 2, 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 20, color: '#3f382f', borderBottom: '1px solid #e4ddd5', paddingBottom: 10 }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#3f382f' }}>{title}</h3>
      {children}
    </div>
  )
}

const p: React.CSSProperties = { margin: '0 0 12px', fontSize: 14, color: '#5f574e', lineHeight: 1.75 }
const li: React.CSSProperties = { fontSize: 14, color: '#5f574e', lineHeight: 1.75, marginBottom: 6 }

export default function TermsPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f1ea' }}>
      <nav
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          borderBottom: '1px solid #e7e1d8',
          background: '#fffdf8',
          boxSizing: 'border-box',
          gap: 16,
        }}
      >
        <Link href="/gallery" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', flexShrink: 0 }}>
          <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 3, padding: 2 }}>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} style={{ width: 9, height: 9, border: '2px solid #111', borderRadius: 2, boxSizing: 'border-box' }} />
            ))}
          </div>
          <strong style={{ fontSize: 20, color: '#111' }}>MNS Studio</strong>
        </Link>
      </nav>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 32, color: '#3f382f' }}>Terms and Conditions</h1>
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
          <Section title="1. Acceptance of Terms">
            <p style={p}>
              By creating an account or using MNS Studio (the &ldquo;Service&rdquo;), you agree to be bound by these Terms and
              Conditions (&ldquo;Terms&rdquo;). If you do not agree, do not use the Service.
            </p>
            <p style={p}>
              These Terms apply to all users, including visitors, registered users, and creators who submit designs for sale.
            </p>
          </Section>

          <Section title="2. Account Registration">
            <Sub title="2.1 Eligibility">
              <p style={p}>
                You must be at least 18 years old to create an account. By registering, you represent that you meet this requirement.
              </p>
            </Sub>
            <Sub title="2.2 Your Responsibilities">
              <p style={p}>
                You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs
                under your account. You agree to provide accurate, current, and complete information during registration and to keep
                it up to date.
              </p>
            </Sub>
            <Sub title="2.3 Account Termination by You">
              <p style={p}>
                You may delete your account at any time by contacting us at{' '}
                <a href="mailto:john@mns.studio" style={{ color: '#6e8d67' }}>john@mns.studio</a>. Deletion of your account will
                not automatically remove designs you have submitted to the marketplace that are associated with active or pending
                orders.
              </p>
            </Sub>
          </Section>

          <Section title="3. Intellectual Property">
            <Sub title="3.1 Your Designs">
              <p style={p}>
                You retain full ownership of the original creative elements you contribute to designs you create using MNS Studio.
              </p>
              <p style={p}>
                By submitting a design for sale through the MNS Studio marketplace, you grant MNS Studio a non-exclusive,
                worldwide, royalty-bearing license to reproduce, print, sell, and distribute your design on physical needlepoint
                canvas and related products (&ldquo;Products&rdquo;). This license remains in effect for as long as your design is
                listed for sale and terminates when you remove your design from the marketplace. Because this license is
                non-exclusive, you remain free to sell or license your design in other formats and through other platforms.
              </p>
              <p style={p}>
                Outside of Product fulfillment, we will not sell, license, or share your designs with third parties except as
                required to operate the Service or as described in our{' '}
                <Link href="/privacy" style={{ color: '#6e8d67' }}>Privacy Policy</Link>.
              </p>
            </Sub>
            <Sub title="3.2 AI-Assisted Content">
              <p style={p}>
                MNS Studio uses artificial intelligence tools to assist in generating design elements based on your inputs. We
                disclose this use of AI here and within the Service. You acknowledge that AI-generated outputs may not be
                independently copyrightable under current law. By submitting an AI-assisted design for sale, you represent that
                you have reviewed its content and take responsibility for it.
              </p>
            </Sub>
            <Sub title="3.3 MNS Studio's IP">
              <p style={p}>
                The MNS Studio platform — including its software, interface, branding, and underlying technology — is owned by MNS
                Studio and protected by applicable intellectual property laws. You may not copy, modify, reverse-engineer, or
                create derivative works from the platform itself.
              </p>
            </Sub>
          </Section>

          <Section title="4. User-Generated Content">
            <Sub title="4.1 What You Can Upload">
              <p style={p}>
                You may upload reference images, photos, or other materials to use as inputs for design creation. By uploading
                content, you represent and warrant that:
              </p>
              <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                <li style={li}>You own the content or have sufficient rights to use it for this purpose</li>
                <li style={li}>The content does not infringe any third-party copyright, trademark, or other intellectual property right</li>
                <li style={li}>The content does not violate any applicable law</li>
              </ul>
            </Sub>
            <Sub title="4.2 Designs Submitted for Sale">
              <p style={p}>
                By submitting a design to the MNS Studio marketplace, you further represent and warrant that:
              </p>
              <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                <li style={li}>The design is your original work or incorporates only content you have the right to license</li>
                <li style={li}>The design does not infringe the intellectual property rights of any third party, including copyrighted artwork, trademarked logos, or characters you do not have rights to reproduce</li>
                <li style={li}>You have not granted exclusive rights in the design to any third party in a way that would conflict with the license granted to MNS Studio under Section 3.1</li>
              </ul>
              <p style={p}>
                MNS Studio reserves the right to remove any design from the marketplace at our discretion, including designs that
                may infringe third-party rights or violate these Terms.
              </p>
            </Sub>
            <Sub title="4.3 Prohibited Content">
              <p style={p}>You may not upload or submit designs that:</p>
              <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                <li style={li}>Infringe the intellectual property rights of others</li>
                <li style={li}>Are obscene, hateful, discriminatory, or otherwise objectionable</li>
                <li style={li}>Include personally identifiable information about others without their consent</li>
                <li style={li}>Violate any applicable law or regulation</li>
              </ul>
            </Sub>
            <Sub title="4.4 DMCA Takedown">
              <p style={p}>
                If you believe content on MNS Studio infringes your copyright, or if you have a dispute regarding ownership of a
                design, please contact us at{' '}
                <a href="mailto:john@mns.studio" style={{ color: '#6e8d67' }}>john@mns.studio</a> with a description of the
                claimed infringement and sufficient information to identify the content at issue. We will respond to valid DMCA
                takedown notices in accordance with applicable law and investigate ownership disputes in good faith.
              </p>
            </Sub>
          </Section>

          <Section title="5. Marketplace & Creator Royalties">
            <Sub title="5.1 How It Works">
              <p style={p}>
                Creators may submit designs to the MNS Studio marketplace. When a customer purchases a Product featuring your
                design, MNS Studio will print and fulfill the order and pay you a royalty on the sale.
              </p>
            </Sub>
            <Sub title="5.2 Royalty Rate">
              <p style={p}>
                Creators earn 20% of the sale price for each Product sold featuring their design. MNS Studio reserves the right
                to adjust royalty rates with reasonable advance notice. Rate changes will not apply to orders already placed
                before the change takes effect.
              </p>
            </Sub>
            <Sub title="5.3 Payouts">
              <p style={p}>
                Royalties are processed through Stripe. You are responsible for providing accurate payout information and for any
                taxes applicable to your royalty income. MNS Studio will issue any required tax documentation in accordance with
                applicable law.
              </p>
            </Sub>
            <Sub title="5.4 Chargebacks & Refunds">
              <p style={p}>
                In the event of a customer chargeback or refund, the corresponding royalty may be reversed or deducted from
                future payouts.
              </p>
            </Sub>
          </Section>

          <Section title="6. Prohibited Uses">
            <p style={p}>You agree not to use the Service to:</p>
            <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
              <li style={li}>Violate any applicable law or regulation</li>
              <li style={li}>Infringe the intellectual property or privacy rights of others</li>
              <li style={li}>Scrape, crawl, or systematically extract data from the platform</li>
              <li style={li}>Introduce malicious code or attempt to interfere with the Service&rsquo;s operation</li>
              <li style={li}>Generate or distribute harmful, harassing, or fraudulent content</li>
              <li style={li}>Resell or sublicense access to the Service without our written consent</li>
            </ul>
          </Section>

          <Section title="7. Termination">
            <p style={p}>
              MNS Studio may suspend or terminate your account at any time, with or without notice, for conduct that we determine
              violates these Terms or is harmful to other users, MNS Studio, or third parties. Upon termination, your license to
              use the Service ends. Sections 3, 4.4, 8, and 9 survive termination.
            </p>
          </Section>

          <Section title="8. Disclaimers">
            <p style={p}>
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, express
              or implied. MNS Studio does not warrant that the Service will be uninterrupted, error-free, or free of harmful
              components. We do not warrant the accuracy or completeness of any content on the platform.
            </p>
          </Section>

          <Section title="9. Limitation of Liability">
            <p style={p}>
              To the fullest extent permitted by law, MNS Studio and its officers, employees, and affiliates will not be liable
              for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service,
              including loss of profits, loss of data, or loss of goodwill. Our total liability to you for any claim arising from
              these Terms or the Service will not exceed the greater of (a) the total royalties paid to you in the three months
              preceding the claim or (b) $100.
            </p>
          </Section>

          <Section title="10. Privacy">
            <p style={p}>
              Your use of the Service is also governed by our{' '}
              <Link href="/privacy" style={{ color: '#6e8d67' }}>Privacy Policy</Link>, which is incorporated into these Terms by
              reference. By using the Service, you consent to the data practices described in the Privacy Policy.
            </p>
          </Section>

          <Section title="11. Changes to These Terms">
            <p style={p}>
              We may update these Terms from time to time. When we do, we will post the revised Terms with an updated date at the
              top and notify you via email or in-app notice. Your continued use of the Service after the effective date of any
              changes constitutes acceptance of the revised Terms.
            </p>
          </Section>

          <Section title="12. Governing Law">
            <p style={p}>
              These Terms are governed by the laws of the State of New Jersey, without regard to conflict of law principles. Any
              disputes arising under these Terms will be resolved exclusively in the state or federal courts located in Ocean
              County, New Jersey, and you consent to personal jurisdiction in those courts.
            </p>
          </Section>

          <Section title="13. Contact">
            <p style={{ ...p, marginBottom: 0 }}>
              For questions about these Terms, DMCA notices, design ownership disputes, or any other matter, contact us at:{' '}
              <a href="mailto:john@mns.studio" style={{ color: '#6e8d67', fontWeight: 600 }}>john@mns.studio</a>
            </p>
          </Section>
        </div>

        <p style={{ marginTop: 24, fontSize: 13, color: '#8a8177', textAlign: 'center' }}>
          Also see our{' '}
          <Link href="/privacy" style={{ color: '#6e8d67' }}>Privacy Policy</Link>
        </p>
      </main>
    </div>
  )
}
