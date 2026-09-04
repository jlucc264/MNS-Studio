import { redirect } from 'next/navigation'
import { API_BASE } from '../lib/api'

// Statically prerendering a redirect bakes it into the RSC payload for the
// client to execute, instead of a real HTTP Location header — invisible to
// a browser (JS picks it up fine) but Googlebot's raw HTTP fetch sees a 307
// with nowhere to go, which Search Console flags as a redirect error.
// force-dynamic makes this a real per-request server redirect instead.
export const dynamic = 'force-dynamic'

/** Where the front door leads, decided per request.
 *
 * The gallery is the right landing page when it is open, and a dead end when
 * it is not: it renders a maintenance notice, so every arriving visitor —
 * including the owner — was being sent straight to a wall while the studio and
 * printing were running perfectly well behind it. That combination did not
 * exist until the gallery was suspended on its own, which is why a hardcoded
 * redirect was fine before and is not now.
 *
 * Lands on /drafts rather than /studio: someone returning to the site wants the
 * work they already have, not a blank canvas.
 *
 * Falls back to the gallery when the status cannot be read. A brief maintenance
 * notice with a studio link on it is a worse landing page but not a broken one,
 * and it keeps a transient API blip from silently changing where the site opens
 * once the gallery is healthy again.
 */
async function galleryIsOpen(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/site-status`, { cache: 'no-store' })
    if (!res.ok) return true
    const status = await res.json()
    return status?.gallery_enabled !== false
  } catch {
    return true
  }
}

export default async function HomePage() {
  redirect((await galleryIsOpen()) ? '/gallery' : '/drafts')
}
