import type { Metadata } from 'next'

const DEFAULT_IMAGE = '/icons/icon-512.png'

/** Builds a page's <title>/description/OG/Twitter metadata. Next merges
 *  `openGraph`/`twitter` wholesale rather than deep-merging keys, so every
 *  page needs its own complete block rather than relying on the root
 *  layout's defaults to fill in gaps. */
export function pageMetadata({
  title,
  description,
  noIndex = false,
  image = DEFAULT_IMAGE,
}: {
  title: string
  description: string
  noIndex?: boolean
  image?: string
}): Metadata {
  // The root layout's title.template ("%s — MNS Studio") only applies to the
  // <title> tag, not to openGraph/twitter — those need the full string here.
  const fullTitle = `${title} — MNS Studio`
  return {
    title,
    description,
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
    openGraph: { title: fullTitle, description, images: [image] },
    twitter: { card: 'summary', title: fullTitle, description, images: [image] },
  }
}
