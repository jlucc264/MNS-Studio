import type { Metadata } from 'next'
import { getCreatorProfile } from '../../../lib/api'
import { pageMetadata } from '../../../lib/seo'

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  try {
    const profile = await getCreatorProfile(params.slug)
    const designCount = profile.items.length
    const image = profile.items.find((i) => i.preview_image_url)?.preview_image_url
    return pageMetadata({
      title: profile.submitter_name,
      description: `${designCount} needlepoint design${designCount === 1 ? '' : 's'} by ${profile.submitter_name} on MNS Studio.`,
      ...(image ? { image } : {}),
    })
  } catch {
    return pageMetadata({
      title: 'Creator Profile',
      description: 'Browse this creator’s needlepoint designs on MNS Studio.',
    })
  }
}

export default function CreatorProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
