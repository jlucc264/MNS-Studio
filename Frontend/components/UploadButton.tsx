'use client'

import { ChangeEvent } from 'react'
import { uploadImage } from '../lib/api'

type Props = {
  onUploaded: (imageUrl: string) => void
  onUploadStart?: () => void
  onUploadError?: (message: string) => void
}

export default function UploadButton({ onUploaded, onUploadStart, onUploadError }: Props) {
  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    onUploadStart?.()

    try {
      const result = await uploadImage(file)
      onUploaded(result.active_image_url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      onUploadError?.(message)
    } finally {
      event.target.value = ''
    }
  }

  return <input type="file" accept="image/*" onChange={handleChange} />
}
