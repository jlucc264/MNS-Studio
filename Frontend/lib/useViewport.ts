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

// A device's shorter dimension stays constant across rotation, so this
// reliably separates phones from tablets (iPad's shortest side is 744px+)
// regardless of current orientation, unlike innerWidth alone.
export function useIsPhoneDevice(): boolean {
  const [isPhone, setIsPhone] = useState(false)

  useEffect(() => {
    const update = () => {
      const touch = navigator.maxTouchPoints > 0
      const shortSide = Math.min(window.innerWidth, window.innerHeight)
      setIsPhone(touch && shortSide < BREAKPOINTS.phone)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return isPhone
}

export function useIsLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(orientation: landscape)')
    const update = () => setIsLandscape(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return isLandscape
}
