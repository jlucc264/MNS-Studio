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
}

type ChatAction = {
  id: string
  label: string
  description: string
  command?: string
  draftCommand?: string
  special?: 'upload' | 'generate'
}

const ACTION_GROUPS: Array<{ label: string; actions: ChatAction[] }> = [
  {
    label: 'Import',
    actions: [
      {
        id: 'upload',
        label: 'Upload an image',
        description: 'Choose a local image file and bring it into the canvas.',
        special: 'upload',
      },
      {
        id: 'import-url',
        label: 'Import from URL',
        description: 'Paste a direct image URL into the advanced command field.',
        draftCommand: 'import https://',
      },
    ],
  },
  {
    label: 'Preview setup',
    actions: [
      { id: 'source-photo', label: 'Use photo mode', description: 'Best for regular artwork and photos.', command: 'use photo' },
      { id: 'source-stitched', label: 'Use stitched photo mode', description: 'Best for photos of existing stitched work.', command: 'use stitched photo' },
      { id: 'source-graphic', label: 'Use graphic / screenshot mode', description: 'Best for logos, screenshots, text, and crisp reference art.', command: 'use graphic art' },
      { id: 'set-width', label: 'Set width', description: 'Enter a width in inches in the advanced command field.', draftCommand: 'set width to ' },
      { id: 'set-height', label: 'Set height', description: 'Enter a height in inches in the advanced command field.', draftCommand: 'set height to ' },
      { id: 'mesh-13', label: 'Use 13 mesh', description: 'Switch the design to 13 mesh.', command: 'use 13 mesh' },
      { id: 'mesh-18', label: 'Use 18 mesh', description: 'Switch the design to 18 mesh.', command: 'use 18 mesh' },
      { id: 'generate-preview', label: 'Generate preview', description: 'Generate or refresh the stitch preview from the current settings.', special: 'generate' },
    ],
  },
  {
    label: 'Cleanup',
    actions: [
      { id: 'clean-on', label: 'Exclude blank canvas', description: 'Treat likely blank background as unpainted canvas.', command: 'clean background on' },
      { id: 'clean-off', label: 'Include background colors', description: 'Turn blank canvas exclusion off.', command: 'clean background off' },
      { id: 'simplify-on', label: 'Simplify colors', description: 'Reduce noisy variation before generating a preview.', command: 'simplify colors on' },
      { id: 'dark-on', label: 'Strengthen dark detail', description: 'Preserve dark edges, lines, and lettering better.', command: 'strengthen dark detail on' },
      { id: 'accents-on', label: 'Preserve accents', description: 'Help small bright accent colors survive conversion.', command: 'preserve accents on' },
    ],
  },
  {
    label: 'Palette editing',
    actions: [
      { id: 'reduce-palette', label: 'Reduce current palette', description: 'Enter a target color count.', draftCommand: 'set colors to ' },
      { id: 'analyze-palette', label: 'Analyze palette', description: 'Show the main colors and stitch counts.', command: 'analyze palette' },
      { id: 'paint-color', label: 'Paint with color', description: 'Enter a DMC code or color name.', draftCommand: 'paint ' },
      { id: 'remove-color', label: 'Remove a color', description: 'Enter a DMC code or color name to remove.', draftCommand: 'turn off ' },
      { id: 'restore-color', label: 'Restore a color', description: 'Enter a DMC code or color name to restore.', draftCommand: 'turn on ' },
      { id: 'merge-colors', label: 'Merge colors', description: 'Merge one or more colors into a target color.', draftCommand: 'merge 907 and 3052 into 907' },
      { id: 'blank-removal', label: 'Remove to blank canvas', description: 'Color removals leave blank canvas cells.', command: 'remove fully' },
      { id: 'nearby-removal', label: 'Fill removals nearby', description: 'Color removals fill with nearby colors.', command: 'fill with nearby' },
    ],
  },
  {
    label: 'History and view',
    actions: [
      { id: 'undo', label: 'Undo last edit', description: 'Undo the last preview edit.', command: 'undo' },
      { id: 'redo', label: 'Redo last edit', description: 'Redo the last undone preview edit.', command: 'redo' },
      { id: 'reset', label: 'Reset preview edits', description: 'Return to the generated base preview.', command: 'reset preview' },
      { id: 'expand', label: 'Expand preview', description: 'Give the preview more room.', command: 'expand preview' },
      { id: 'show-chat', label: 'Show chat and panels', description: 'Bring the side panels back.', command: 'show chat' },
      { id: 'settings', label: 'Show current settings', description: 'Review source mode, size, mesh, color budget, and toggles.', command: 'show settings' },
    ],
  },
]

const ACTIONS = ACTION_GROUPS.flatMap((group) => group.actions)

export default function ChatPanel({
  onSubmitMessage,
  onUploadFile,
  onGeneratePreview,
  canGeneratePreview,
  hasPreview,
  sourceType,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [selectedActionId, setSelectedActionId] = useState('')

  useEffect(() => {
    const node = logRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages])

  const selectedAction = ACTIONS.find((action) => action.id === selectedActionId)
  const activeModeLabel =
    sourceType === 'graphic_art'
      ? 'Graphic / screenshot mode'
      : sourceType === 'stitched_photo'
        ? 'Stitched photo mode'
        : 'Photo mode'

  function openFilePicker() {
    if (busy) return
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

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

  async function runSelectedAction() {
    if (!selectedAction || busy) return

    if (selectedAction.special === 'upload') {
      openFilePicker()
      return
    }

    if (selectedAction.special === 'generate') {
      onGeneratePreview()
      return
    }

    if (selectedAction.command) {
      await runQuickCommand(selectedAction.command)
      return
    }

    if (selectedAction.draftCommand) {
      setInput(selectedAction.draftCommand)
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
        gridTemplateRows: 'auto minmax(48px, 64px) auto',
        gap: 0,
        height: '100%',
        minHeight: 0,
        border: '1px solid #d9d9d9',
        borderRadius: 10,
        background: dragActive ? '#f3f7ff' : '#ffffff',
        boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: 6,
          padding: 8,
          borderBottom: '1px solid #ececec',
          background: '#ffffff',
        }}
      >
        <div style={{ display: 'grid', gap: 3 }}>
          <strong style={{ fontSize: 14 }}>Canvas assistant</strong>
          <span style={{ fontSize: 12.5, color: '#6f675f' }}>
            Choose an action or type a command. Current source: {activeModeLabel}.
          </span>
        </div>

        <select
          value={selectedActionId}
          onChange={(event) => setSelectedActionId(event.target.value)}
          style={{
            width: '100%',
            border: '1px solid #d0c8bd',
            borderRadius: 8,
            padding: '7px 9px',
            font: 'inherit',
            fontSize: 13,
            color: '#3f382f',
            background: '#fffdf8',
          }}
        >
          <option value="">Choose an action...</option>
          {ACTION_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.actions.map((action) => (
                <option key={action.id} value={action.id}>
                  {action.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {selectedAction && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              alignItems: 'center',
              gap: 10,
              padding: 8,
              border: '1px solid #e7e1d8',
              borderRadius: 8,
              background: '#fffdf8',
            }}
          >
            <div style={{ display: 'grid', gap: 3 }}>
              <strong style={{ fontSize: 13 }}>{selectedAction.label}</strong>
              <span style={{ fontSize: 12.5, color: '#6f675f', lineHeight: 1.3 }}>
                {selectedAction.description}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void runSelectedAction()}
              disabled={busy || (selectedAction.special === 'generate' && !canGeneratePreview)}
              style={{
                justifySelf: 'start',
                border: '1px solid #5c7856',
                background: '#6e8d67',
                color: '#fff',
                borderRadius: 8,
                padding: '6px 9px',
                font: 'inherit',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy || (selectedAction.special === 'generate' && !canGeneratePreview) ? 0.55 : 1,
              }}
            >
              {selectedAction.draftCommand ? 'Fill command' : selectedAction.special === 'upload' ? 'Choose file' : 'Run action'}
            </button>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {[
            hasPreview ? 'analyze palette' : 'show settings',
            canGeneratePreview && !hasPreview ? 'generate preview' : 'use graphic art',
            sourceType === 'graphic_art' ? 'preserve accents on' : 'simplify colors on',
          ].filter(Boolean).map((command) => (
            <button
              key={String(command)}
              type="button"
              onClick={() => void runQuickCommand(String(command))}
              disabled={busy}
              style={{
                border: '1px solid #d0d0d0',
                background: '#f8f8f8',
                borderRadius: 999,
                padding: '4px 8px',
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
          minHeight: 0,
          maxHeight: 64,
          overflow: 'auto',
          padding: 8,
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
              padding: '6px 8px',
              whiteSpace: 'pre-wrap',
            }}
          >
            {message.text}
          </div>
        ))} 
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: 'grid',
          padding: 8,
          borderTop: '1px solid #e8e8e8',
          background: 'transparent',
          minHeight: 0,
        }}
      >
        <label
          style={{
            display: 'grid',
            gap: 5,
            fontSize: 13,
            fontWeight: 700,
            color: '#3f382f',
          }}
        >
          Chat or command
          <textarea
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or drop an image here."
            style={{
              resize: 'none',
              border: '1px solid #d0d0d0',
              borderRadius: 10,
              padding: '8px 10px',
              font: 'inherit',
              lineHeight: 1.4,
            }}
          />
        </label>
      </form>
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
