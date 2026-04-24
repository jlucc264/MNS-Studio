'use client'

import { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import { CandidateImage } from '../lib/api'

type Message = {
  id: string
  role: 'assistant' | 'user'
  text: string
}

type CommandResult = {
  reply: string
  candidates?: CandidateImage[]
  note?: string
}

type Props = {
  onSubmitMessage: (message: string) => Promise<CommandResult>
  onUploadFile: (file: File) => Promise<string>
  onSelectCandidate: (image: CandidateImage) => Promise<string>
  onGeneratePreview: () => void
  canGeneratePreview: boolean
  sourceType: 'photo' | 'stitched_photo'
  onSourceTypeChange: (sourceType: 'photo' | 'stitched_photo') => void
}

export default function ChatPanel({
  onSubmitMessage,
  onUploadFile,
  onSelectCandidate,
  onGeneratePreview,
  canGeneratePreview,
  sourceType,
  onSourceTypeChange,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text:
        'Ask me to search the web, import an image, change settings, edit the preview, or type `help` for guided commands.',
    },
  ])
  const [input, setInput] = useState('')
  const [candidateImages, setCandidateImages] = useState<CandidateImage[]>([])
  const [candidateNote, setCandidateNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  useEffect(() => {
    const node = logRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [candidateImages.length, messages])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = input.trim()
    if (!message || busy) return

    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text: message }])
    setInput('')
    setBusy(true)

    try {
      const result = await onSubmitMessage(message)
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: result.reply },
      ])
      setCandidateImages(result.candidates ?? [])
      setCandidateNote(result.note ?? null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command failed'
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: message },
      ])
      setCandidateImages([])
      setCandidateNote(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleUpload(file: File) {
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', text: `Upload file: ${file.name}` },
    ])
    setBusy(true)

    try {
      const reply = await onUploadFile(file)
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: reply },
      ])
      setCandidateImages([])
      setCandidateNote(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: message },
      ])
      setCandidateNote(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || busy) return

    await handleUpload(file)
    event.target.value = ''
  }

  async function handleCandidateClick(image: CandidateImage) {
    if (busy) return

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: 'user',
        text: `Use web image: ${image.title ?? image.url}`,
      },
    ])
    setBusy(true)

    try {
      const reply = await onSelectCandidate(image)
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: reply },
      ])
      setCandidateImages([])
      setCandidateNote(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to use that image'
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: message },
      ])
      setCandidateNote(null)
    } finally {
      setBusy(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()

    const form = event.currentTarget.form
    if (form) {
      form.requestSubmit()
    }
  }

  async function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault()
    setDragActive(false)
    if (busy) return

    const file = event.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    await handleUpload(file)
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: 0,
        border: '1px solid #d9d9d9',
        borderRadius: 14,
        background: '#ffffff',
        boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}
    >
      <div
        ref={logRef}
        style={{
          display: 'grid',
          gap: 8,
          height: 260,
          overflow: 'auto',
          padding: 12,
          background: '#fafafa',
        }}
      >
        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              justifySelf: message.role === 'user' ? 'end' : 'start',
              maxWidth: '90%',
              background: message.role === 'user' ? '#e8f0ff' : 'white',
              border: '1px solid #ddd',
              borderRadius: 10,
              padding: '8px 10px',
              whiteSpace: 'pre-wrap',
            }}
          >
            {message.text}
          </div>
        ))}

        {candidateImages.length > 0 && (
          <div style={{ display: 'grid', gap: 8, paddingTop: 4 }}>
            <div style={{ display: 'grid', gap: 4 }}>
              <strong style={{ fontSize: 13 }}>Web image options</strong>
              {candidateNote && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#556',
                    background: '#f4f7fb',
                    border: '1px solid #dde6f2',
                    borderRadius: 8,
                    padding: '6px 8px',
                  }}
                >
                  {candidateNote}
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gap: 8, maxHeight: 220, overflow: 'auto' }}>
              {candidateImages.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => handleCandidateClick(image)}
                  disabled={busy}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 1fr',
                    gap: 10,
                    alignItems: 'center',
                    padding: 8,
                    borderRadius: 8,
                    border: '1px solid #ddd',
                    background: 'white',
                    textAlign: 'left',
                  }}
                >
                  <img
                    src={image.url}
                    alt={image.title ?? 'candidate image'}
                    style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6 }}
                  />
                  <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {image.title ?? 'Untitled image'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {image.provider && (
                        <span
                          style={{
                            fontSize: 11,
                            color: '#355',
                            background: '#eef4f7',
                            border: '1px solid #d9e4ea',
                            borderRadius: 999,
                            padding: '2px 6px',
                            lineHeight: 1.2,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {image.provider}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 11,
                          color: '#666',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {image.url}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <form
        onSubmit={handleSubmit}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!busy) setDragActive(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (!busy) setDragActive(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setDragActive(false)
        }}
        onDrop={handleDrop}
        style={{
          display: 'grid',
          gap: 8,
          padding: 12,
          borderTop: '1px solid #e8e8e8',
          background: dragActive ? '#f3f7ff' : '#ffffff',
        }}
      >
        <textarea
          rows={3}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command or drop an image here."
          style={{
            resize: 'none',
            border: '1px solid #d0d0d0',
            borderRadius: 10,
            padding: '10px 12px',
            font: 'inherit',
            lineHeight: 1.4,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onGeneratePreview}
              disabled={busy || !canGeneratePreview}
              style={{
                border: '1px solid #d0d0d0',
                background: '#f8f8f8',
                borderRadius: 8,
                padding: '6px 10px',
                font: 'inherit',
                cursor: busy || !canGeneratePreview ? 'default' : 'pointer',
              }}
            >
              Generate stitch preview
            </button>
            <select
              value={sourceType}
              onChange={(event) =>
                onSourceTypeChange(event.target.value as 'photo' | 'stitched_photo')
              }
              style={{
                border: '1px solid #d0d0d0',
                background: '#ffffff',
                borderRadius: 8,
                padding: '6px 10px',
                font: 'inherit',
              }}
            >
              <option value="photo">Photo</option>
              <option value="stitched_photo">Stitched photo</option>
            </select>
          </div>
        </div>
      </form>
    </div>
  )
}
