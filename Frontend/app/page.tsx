import { redirect } from 'next/navigation'

// Statically prerendering a redirect bakes it into the RSC payload for the
// client to execute, instead of a real HTTP Location header — invisible to
// a browser (JS picks it up fine) but Googlebot's raw HTTP fetch sees a 307
// with nowhere to go, which Search Console flags as a redirect error.
// force-dynamic makes this a real per-request server redirect instead.
export const dynamic = 'force-dynamic'

export default function HomePage() {
  redirect('/gallery')
}
