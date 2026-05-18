'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'mns_tutorial_seen'

interface Step {
  id: string
  title: string
  body: string
  target: string | null
  position?: 'top' | 'bottom' | 'left' | 'right'
  image?: string
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to MNS Studio',
    body: 'Create beautiful needlepoint and cross-stitch patterns from any photo or image. This quick tour covers the essentials — takes about 30 seconds.',
    target: null,
  },
  {
    id: 'upload',
    title: 'Start with an image',
    body: 'Upload a photo, screenshot, or artwork. Drag and drop or tap to browse. Simpler images with bold shapes and strong contrast work best.',
    target: '[data-tutorial="upload-zone"]',
    position: 'right',
  },
  {
    id: 'steps',
    title: 'Three-step workflow',
    body: 'Upload your image, adjust the design settings and generate a stitch preview, then finalize your pattern and download the PDF.',
    target: '[data-tutorial="workflow-steps"]',
    position: 'right',
  },
  {
    id: 'canvas',
    title: 'Your stitch preview',
    body: 'After generating, your design appears here. Zoom in to see individual stitches, pinch to zoom on touch screens, and paint colors directly on the canvas.',
    target: '[data-tutorial="canvas-section"]',
    position: 'left',
  },
  {
    id: 'design-settings',
    title: 'Tune your import settings',
    body: 'Source Type, Size, Contrast, and Exclude blank canvas all shape how your image is rendered. Try different combinations — Photo vs Graphic, Normal vs High contrast — then regenerate to see the difference.',
    target: '[data-tutorial="design-settings"]',
    position: 'right',
    image: '/tutorial/design-settings.png',
  },
  {
    id: 'palette-slider',
    title: 'Adjust your color palette',
    body: 'After generating, drag this slider left to reduce the number of colors in your design. Fewer colors means a simpler stitch — drag right to restore the full generated palette.',
    target: '[data-tutorial="palette-slider"]',
    position: 'right',
    image: '/tutorial/palette-slider.png',
  },
  {
    id: 'palette-panel',
    title: 'Create and Select tools',
    body: 'Use Create mode to paint individual cells, draw shapes, or swap colors across the canvas. Switch to Select mode to lasso a region and apply or replace colors within it.',
    target: '[data-tutorial="palette-panel"]',
    position: 'left',
    image: '/tutorial/palette-panel.png',
  },
  {
    id: 'save',
    title: 'Save your work',
    body: 'Save your draft anytime — your design is stored to your account so you can return and keep editing. You can have multiple saved designs.',
    target: '[data-tutorial="save-button"]',
    position: 'right',
  },
  {
    id: 'done',
    title: "You're all set!",
    body: 'Upload your first image to get started. You can replay this tour anytime using the ? button in the top navigation.',
    target: null,
  },
]

const PAD = 10
const POPOVER_W = 290
const POPOVER_W_IMAGE = 340

interface Rect { top: number; left: number; width: number; height: number }

function getPopoverStyle(targetRect: Rect | null, position: Step['position'], hasImage: boolean): React.CSSProperties {
  const w = hasImage ? POPOVER_W_IMAGE : POPOVER_W
  const base: React.CSSProperties = {
    position: 'fixed',
    zIndex: 10002,
    background: '#fffdf8',
    borderRadius: 12,
    padding: '20px 22px',
    width: w,
    boxShadow: '0 8px 40px rgba(0,0,0,0.24)',
    border: '1px solid #e0d9cf',
    fontFamily: 'Georgia, "Times New Roman", serif',
  }

  if (!targetRect) {
    return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }

  const vw = window.innerWidth
  const vh = window.innerHeight
  let top = 0
  let left = 0

  if (position === 'right') {
    top = targetRect.top
    left = targetRect.left + targetRect.width + PAD + 8
    if (left + w > vw - 8) left = targetRect.left - w - PAD - 8
  } else if (position === 'left') {
    top = targetRect.top
    left = targetRect.left - w - PAD - 8
    if (left < 8) left = targetRect.left + targetRect.width + PAD + 8
  } else if (position === 'top') {
    left = targetRect.left + targetRect.width / 2 - w / 2
    top = targetRect.top - PAD - 8 - 160
    if (top < 80) top = targetRect.top + targetRect.height + PAD + 8
  } else {
    left = targetRect.left + targetRect.width / 2 - w / 2
    top = targetRect.top + targetRect.height + PAD + 8
  }

  top = Math.max(8, Math.min(top, vh - 220))
  left = Math.max(8, Math.min(left, vw - w - 8))

  return { ...base, top, left }
}

export function StudioTutorial({ onClose }: { onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const step = STEPS[stepIndex]

  const measureTarget = useCallback(() => {
    if (!step.target) { setTargetRect(null); return }
    const el = document.querySelector(step.target)
    if (!el) { setTargetRect(null); return }
    const r = el.getBoundingClientRect()
    setTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [step.target])

  useEffect(() => {
    measureTarget()
    window.addEventListener('resize', measureTarget)
    return () => window.removeEventListener('resize', measureTarget)
  }, [measureTarget])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight' && stepIndex < STEPS.length - 1) setStepIndex(i => i + 1)
      if (e.key === 'ArrowLeft' && stepIndex > 0) setStepIndex(i => i - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const finish = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    onClose()
  }

  const popoverStyle = getPopoverStyle(targetRect, step.position, Boolean(step.image))

  return (
    <>
      {/* Backdrop */}
      {targetRect ? (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'auto' }}
            onClick={finish}
          />
          {/* Spotlight hole via box-shadow */}
          <div style={{
            position: 'fixed',
            top: targetRect.top - PAD,
            left: targetRect.left - PAD,
            width: targetRect.width + PAD * 2,
            height: targetRect.height + PAD * 2,
            borderRadius: 8,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
            zIndex: 10001,
            pointerEvents: 'none',
          }} />
        </>
      ) : (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.62)', pointerEvents: 'auto' }}
          onClick={finish}
        />
      )}

      {/* Popover card */}
      <div ref={popoverRef} style={popoverStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <strong style={{ fontSize: 16, color: '#3f382f', lineHeight: 1.3 }}>{step.title}</strong>
            <button
              type="button"
              onClick={finish}
              aria-label="Close tutorial"
              style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 16, color: '#9a9287', padding: 0, flexShrink: 0, lineHeight: 1, marginTop: 2 }}
            >✕</button>
          </div>

          {step.image && (
            <img
              src={step.image}
              alt=""
              style={{ width: '100%', borderRadius: 8, border: '1px solid #e0d9cf', display: 'block' }}
            />
          )}

          <p style={{ margin: 0, fontSize: 14, color: '#5f574f', lineHeight: 1.65 }}>{step.body}</p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStepIndex(i)}
                  aria-label={`Go to step ${i + 1}`}
                  style={{
                    width: i === stepIndex ? 16 : 6,
                    height: 6,
                    borderRadius: 999,
                    border: 0,
                    background: i === stepIndex ? '#6e8d67' : '#d5cec6',
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'width 0.2s',
                  }}
                />
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {stepIndex > 0 && (
                <button
                  type="button"
                  onClick={() => setStepIndex(i => i - 1)}
                  style={{ border: '1px solid #d7d0c8', borderRadius: 7, padding: '7px 14px', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#3f382f', fontFamily: 'inherit' }}
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={stepIndex < STEPS.length - 1 ? () => setStepIndex(i => i + 1) : finish}
                style={{ border: '1px solid #5c7856', borderRadius: 7, padding: '7px 16px', background: '#6e8d67', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#fff', fontFamily: 'inherit' }}
              >
                {stepIndex < STEPS.length - 1 ? 'Next' : 'Get started'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export function useTutorial() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setShow(true)
  }, [])

  return {
    show,
    open: () => setShow(true),
    close: () => setShow(false),
  }
}
