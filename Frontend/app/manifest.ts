import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MNS Studio',
    short_name: 'MNS Studio',
    description: 'Design needlepoint canvases from your photos — edit stitch by stitch, then order the printed canvas.',
    start_url: '/studio',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f5f1ea',
    theme_color: '#f5f1ea',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
