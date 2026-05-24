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

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

const HISTORY_WINDOW = 6

type Props = {
  onSubmitMessage: (message: string, history: HistoryMessage[]) => Promise<CommandResult>
  onUploadFile: (file: File) => Promise<string>
  isLoggedIn: boolean
  onSignIn: () => void
}

const WELCOME =
  "Hi! I'm your canvas assistant. I can help you generate and edit your needlepoint design, create AI source images, adjust settings, and answer questions. What would you like to do?"

export default function ChatPanel({
  onSubmitMessage,
  onUploadFile,
  isLoggedIn,
  onSignIn,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', text: WELCOME },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  useEffect(() => {
    const node = logRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages])

  function openFilePicker() {
    if (busy) return
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  async function sendMessage(message: string) {
    const trimmed = message.trim()
    if (!trimmed || busy) return

    const history: HistoryMessage[] = messages
      .filter((m) => m.id !== 'welcome' && m.text !== '…')
      .slice(-HISTORY_WINDOW)
      .map((m) => ({ role: m.role, content: m.text }))

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: trimmed }])
    setInput('')
    setBusy(true)

    const thinkingId = crypto.randomUUID()
    setMessages((prev) => [...prev, { id: thinkingId, role: 'assistant', text: '…' }])

    try {
      const result = await onSubmitMessage(trimmed, history)
      setMessages((prev) =>
        prev.map((m) => (m.id === thinkingId ? { ...m, text: result.reply } : m))
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Something went wrong.'
      setMessages((prev) =>
        prev.map((m) => (m.id === thinkingId ? { ...m, text: msg } : m))
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await sendMessage(input)
  }

  async function handleUpload(file: File) {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', text: `Upload: ${file.name}` },
    ])
    setBusy(true)
    const uploadId = crypto.randomUUID()
    setMessages((prev) => [...prev, { id: uploadId, role: 'assistant', text: '…' }])

    try {
      const reply = await onUploadFile(file)
      setMessages((prev) =>
        prev.map((m) => (m.id === uploadId ? { ...m, text: reply } : m))
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Upload failed.'
      setMessages((prev) =>
        prev.map((m) => (m.id === uploadId ? { ...m, text: msg } : m))
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || busy) {
      event.target.value = ''
      return
    }
    await handleUpload(file)
    event.target.value = ''
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    const form = event.currentTarget.form
    if (form) form.requestSubmit()
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
      onDragEnter={(e) => { e.preventDefault(); if (!busy) setDragActive(true) }}
      onDragOver={(e) => { e.preventDefault(); if (!busy) setDragActive(true) }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragActive(false)
      }}
      onDrop={(e) => void handleDrop(e)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        border: `1px solid ${dragActive ? '#91b3e8' : '#d9d9d9'}`,
        borderRadius: 10,
        background: dragActive ? '#f3f7ff' : '#ffffff',
        boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #ececec', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13.5, color: '#3f382f' }}>MNS Pro</strong>
        <button
          type="button"
          onClick={openFilePicker}
          disabled={busy}
          style={{
            border: '1px solid #d8d2ca',
            background: '#fafaf8',
            borderRadius: 999,
            padding: '3px 10px',
            font: 'inherit',
            fontSize: 12,
            color: '#4a4440',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          Upload image
        </button>
      </div>

      {/* Chat log */}
      <div
        ref={logRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 10px 4px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minHeight: 0,
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '88%',
              background: msg.role === 'user' ? '#e8f0ff' : '#f5f3f0',
              border: `1px solid ${msg.role === 'user' ? '#c8d8f8' : '#e4ddd5'}`,
              borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
              padding: '7px 10px',
              fontSize: 13,
              lineHeight: 1.45,
              color: '#2e2820',
              whiteSpace: 'pre-wrap',
              opacity: msg.text === '…' ? 0.55 : 1,
            }}
          >
            {msg.text === '…' ? (
              <span style={{ letterSpacing: 2 }}>···</span>
            ) : (
              msg.text
            )}
          </div>
        ))}
      </div>

      {/* Input area */}
      {isLoggedIn ? (
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            gap: 6,
            padding: '8px 10px',
            borderTop: '1px solid #ececec',
            background: '#fdfcfb',
            flexShrink: 0,
            alignItems: 'flex-end',
          }}
        >
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything or describe what you want…"
            disabled={busy}
            style={{
              flex: 1,
              resize: 'none',
              border: '1px solid #d0cac2',
              borderRadius: 8,
              padding: '7px 9px',
              font: 'inherit',
              fontSize: 13,
              lineHeight: 1.4,
              color: '#2e2820',
              background: busy ? '#f8f7f5' : '#fff',
              outline: 'none',
              minHeight: 34,
              maxHeight: 100,
              overflowY: 'auto',
            }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            style={{
              border: 'none',
              background: busy || !input.trim() ? '#c8c2ba' : '#6e8d67',
              color: '#fff',
              borderRadius: 8,
              padding: '7px 13px',
              font: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              cursor: busy || !input.trim() ? 'default' : 'pointer',
              flexShrink: 0,
              height: 34,
              alignSelf: 'flex-end',
            }}
          >
            Send
          </button>
        </form>
      ) : (
        <div style={{ padding: '12px 14px', borderTop: '1px solid #ececec', background: '#fdfcfb', flexShrink: 0, textAlign: 'center' }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#6b5f54' }}>Sign in to use MNS Pro</p>
          <button
            type="button"
            onClick={onSignIn}
            style={{
              border: 'none',
              background: '#6e8d67',
              color: '#fff',
              borderRadius: 8,
              padding: '7px 18px',
              font: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign in
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  )
}
