'use client'

import { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'

type Message = {
  id: string
  role: 'assistant' | 'user'
  text: string
}

type CommandResult = {
  reply: string
}

type Props = {
  onSubmitMessage: (message: string) => Promise<CommandResult>
  onUploadFile: (file: File) => Promise<string>
  onGeneratePreview: () => void
  canGeneratePreview: boolean
  hasPreview: boolean
  sourceType: 'photo' | 'stitched_photo' | 'graphic_art'
  onSourceTypeChange: (sourceType: 'photo' | 'stitched_photo' | 'graphic_art') => void
}

export default function ChatPanel({
  onSubmitMessage,
  onUploadFile,
  onGeneratePreview,
  canGeneratePreview,
  hasPreview,
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
        'Upload an image, paste an image URL, change settings, edit the preview, or type `help` for guided commands.',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    const node = logRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages])

  const guideContent = (() => {
    if (sourceType === 'graphic_art') {
      return {
        title: 'Graphic / screenshot workflow',
        lines: [
          'Best for screenshots, logos, stitched reference art, and crisp sign-style images.',
          'Start with a high color budget, then use Auto reduce to trim the palette without losing accents.',
          'If tiny details are still getting lost, try `preserve accents on` before pushing contrast higher.',
        ],
      }
    }

    if (sourceType === 'stitched_photo') {
      return {
        title: 'Stitched photo workflow',
        lines: [
          'Best for photographed stitched work where fabric or canvas colors interfere with the design.',
          'Use this when you want cleaner palette discipline and less screenshot-style sharpness.',
          'Try `clean background on` only when neutral canvas tones are stealing too much color budget.',
        ],
      }
    }

    return {
      title: 'Photo workflow',
      lines: [
        'Best for regular photos, artwork, and cases where text continuity needs softer preservation.',
        'If the preview feels noisy, try `simplify colors on` before changing source modes.',
        'If dark edges or lettering feel weak, try `strengthen dark detail on` before raising contrast.',
      ],
    }
  })()

  const quickSuggestions = (() => {
    if (!canGeneratePreview) {
      return ['help', 'import https://...', 'use graphic art']
    }

    if (!hasPreview) {
      return ['generate preview', 'show settings', 'preserve accents on']
    }

    if (sourceType === 'graphic_art') {
      return ['preserve accents on', 'simplify colors on', 'show settings']
    }

    if (sourceType === 'stitched_photo') {
      return ['clean background on', 'show settings', 'generate preview']
    }

    return ['strengthen dark detail on', 'simplify colors on', 'show settings']
  })()

  async function runQuickCommand(command: string) {
    if (busy) return

    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text: command }])
    setBusy(true)

    try {
      const result = await onSubmitMessage(command)
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: result.reply },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command failed'
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: message },
      ])
    } finally {
      setBusy(false)
    }
  }

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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command failed'
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: message },
      ])
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: message },
      ])
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

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()

    const form = event.currentTarget.form
    if (form) {
      form.requestSubmit()
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragActive(false)
    if (busy) return

    const file = event.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    await handleUpload(file)
  }

  return (
    <div
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
      onDrop={(event) => void handleDrop(event)}
      style={{
        display: 'grid',
        gap: 0,
        border: '1px solid #d9d9d9',
        borderRadius: 14,
        background: dragActive ? '#f3f7ff' : '#ffffff',
        boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: 8,
          padding: 12,
          borderBottom: '1px solid #ececec',
          background: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>Quick guide</strong>
          <button
            type="button"
            onClick={() => setShowGuide((current) => !current)}
            style={{
              border: '1px solid #d0d0d0',
              background: '#fff',
              borderRadius: 8,
              padding: '4px 8px',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            {showGuide ? 'Hide' : 'Show'}
          </button>
        </div>

        {showGuide && (
          <div
            style={{
              display: 'grid',
              gap: 6,
              padding: 10,
              border: '1px solid #e5e5e5',
              borderRadius: 10,
              background: '#fafafa',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{guideContent.title}</div>
            {guideContent.lines.map((line) => (
              <div key={line} style={{ fontSize: 12.5, color: '#555', lineHeight: 1.35 }}>
                {line}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {quickSuggestions.map((command) => (
            <button
              key={command}
              type="button"
              onClick={() => void runQuickCommand(command)}
              disabled={busy}
              style={{
                border: '1px solid #d0d0d0',
                background: '#f8f8f8',
                borderRadius: 999,
                padding: '6px 10px',
                font: 'inherit',
                fontSize: 12,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              {command}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={logRef}
        style={{
          display: 'grid',
          gap: 8,
          height: 'clamp(180px, 28vh, 260px)',
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
        style={{
          display: 'grid',
          gap: 8,
          padding: 12,
          borderTop: '1px solid #e8e8e8',
          background: 'transparent',
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
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              style={{
                border: '1px solid #d0d0d0',
                background: '#ffffff',
                borderRadius: 8,
                padding: '6px 10px',
                font: 'inherit',
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              Upload file
            </button>
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
                onSourceTypeChange(event.target.value as 'photo' | 'stitched_photo' | 'graphic_art')
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
              <option value="graphic_art">Graphic / screenshot art</option>
            </select>
          </div>
        </div>
      </form>
    </div>
  )
}
