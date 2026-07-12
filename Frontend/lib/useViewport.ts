'use client'

import { useEffect, useState } from 'react'

export const BREAKPOINTS = {
  phone: 600,
  tablet: 768,
  studio: 980,
} as const

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 800

export function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })

  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return size
}

export function useIsMobile(breakpoint: number = BREAKPOINTS.studio): boolean {
  const { width } = useViewport()
  return width < breakpoint
}

export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)')
    const update = () => setIsTouch(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return isTouch
}
