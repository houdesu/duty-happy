import type { BrowserWindow } from 'electron'
import type { Appearance } from '../shared/types'

export function applyWindowChrome(win: BrowserWindow, appearance: Appearance): void {
  const night = appearance === 'night'
  const backgroundColor = night ? '#071321' : '#f4f6fb'
  const symbolColor = night ? '#eaf3ff' : '#1b2430'
  win.setBackgroundColor(backgroundColor)
  try {
    win.setTitleBarOverlay({ color: backgroundColor, symbolColor, height: 48 })
  } catch {
    /* titleBarOverlay not available */
  }
}
