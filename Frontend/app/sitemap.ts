import type { MetadataRoute } from 'next'
import { listCreatorSlugs } from '../lib/api'

const BASE_URL = 'https://www.mns.studio'

// Without this, creator profile pages are only discoverable by Google
// crawling links to them rather than being told about them directly — a
// likely contributor to the "discovered/crawled, currently not indexed"
// entries in Search Console. Revalidate daily via ISR rather than only on
// deploy, so a new creator shows up here without needing a redeploy.
export const revalidate = 86400

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/gallery`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE_URL}/studio`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE_URL}/tips`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.1 },
    { url: `${BASE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.1 },
  ]

  const creators = await listCreatorSlugs().catch(() => [])
  const creatorEntries: MetadataRoute.Sitemap = creators.map((c) => ({
    url: `${BASE_URL}/gallery/${encodeURIComponent(c.slug)}`,
    lastModified: c.updated_at ? new Date(c.updated_at) : now,
    changeFrequency: 'weekly',
    priority: 0.4,
  }))

  return [...staticEntries, ...creatorEntries]
}
