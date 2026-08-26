import type { ITheme } from '@xterm/xterm'
import type { Appearance } from '../../../shared/types'

export const TERM_FONT_FAMILY =
  "'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', 'Sarasa Mono SC', Consolas, 'Microsoft YaHei Mono', monospace"

export const TERM_THEMES: Record<Appearance, ITheme> = {
  light: {
    background: '#ffffff',
    foreground: '#1b2430',
    cursor: '#c9a21b',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(245,197,24,0.46)',
    selectionInactiveBackground: 'rgba(15,143,126,0.18)',
    black: '#1b2430',
    red: '#e11d48',
    green: '#15803d',
    yellow: '#b45309',
    blue: '#1d4ed8',
    magenta: '#a21caf',
    cyan: '#0f8f7e',
    white: '#e5e7eb',
    brightBlack: '#66758a',
    brightRed: '#e11d48',
    brightGreen: '#16a34a',
    brightYellow: '#ca8a04',
    brightBlue: '#2563eb',
    brightMagenta: '#c026d3',
    brightCyan: '#0f766e',
    brightWhite: '#111827'
  },
  night: {
    background: '#0c1c32',
    foreground: '#eaf3ff',
    cursor: '#ffd84d',
    cursorAccent: '#071321',
    selectionBackground: 'rgba(255,216,77,0.34)',
    selectionInactiveBackground: 'rgba(94,234,212,0.16)',
    black: '#071321',
    red: '#ff6b8a',
    green: '#4ade80',
    yellow: '#ffd84d',
    blue: '#7dd3fc',
    magenta: '#e879f9',
    cyan: '#5eead4',
    white: '#eaf3ff',
    brightBlack: '#8aa3c2',
    brightRed: '#fb7185',
    brightGreen: '#86efac',
    brightYellow: '#fde68a',
    brightBlue: '#bae6fd',
    brightMagenta: '#f0abfc',
    brightCyan: '#99f6e4',
    brightWhite: '#ffffff'
  }
}
