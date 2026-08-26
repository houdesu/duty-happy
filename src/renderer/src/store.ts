import { create } from 'zustand'
import type { Appearance, AppUpdateStatus, SessionPublic, Snippet, TabStatus } from '../../shared/types'

export interface Tab {
  id: string
  sessionId: string
  title: string
  status: TabStatus
  error?: string
  cwd?: string
}

interface Toast {
  id: string
  message: string
  tone: 'ok' | 'err'
}

export interface ConfirmRequest {
  title: string
  message: string
  ok: string
  cancel: string
  danger: boolean
  code?: string
  sessionAll?: boolean
}

export interface ConfirmOptions {
  title?: string
  message: string
  ok?: string
  cancel?: string
  danger?: boolean
  code?: string
  sessionAll?: boolean
  onSessionAll?: () => void
}

export interface ConfirmCloseExtra {
  sessionAll?: boolean
}

export interface AppState {
  ready: boolean
  sessions: SessionPublic[]
  snippets: Snippet[]
  history: string[]
  tabs: Tab[]
  activeTabId: string | null
  query: string
  leftTab: 'sessions' | 'files'
  rightTab: 'snippets' | 'history' | 'ai'
  rightOpen: boolean
  paletteOpen: boolean
  editing: SessionPublic | 'new' | null
  toasts: Toast[]
  confirm: ConfirmRequest | null
  appearance: Appearance
  termFontSize: number
  rightDockWidth: number
  aiDraft: string | null
  appVersion: string
  update: AppUpdateStatus | null
  hydrate: () => Promise<void>
  setAppearance: (appearance: Appearance) => Promise<void>
  setTermFontSize: (size: number) => void
  setRightDockWidth: (width: number) => void
  setQuery: (query: string) => void
  setLeftTab: (tab: 'sessions' | 'files') => void
  setRightTab: (tab: 'snippets' | 'history' | 'ai') => void
  openAi: () => void
  fillAiDraft: (text: string) => void
  clearAiDraft: () => void
  toggleRight: () => void
  setPaletteOpen: (open: boolean) => void
  setEditing: (editing: SessionPublic | 'new' | null) => void
  setUpdate: (update: AppUpdateStatus) => void
  toast: (message: string, tone?: 'ok' | 'err') => void
  askConfirm: (options: ConfirmOptions) => Promise<boolean>
  closeConfirm: (ok: boolean, extra?: ConfirmCloseExtra) => void
  refreshSessions: () => Promise<void>
  refreshSnippets: () => Promise<void>
  refreshHistory: () => Promise<void>
  openSession: (session: SessionPublic) => string
  closeTab: (tabId: string) => Promise<void>
  setActiveTab: (tabId: string) => void
  patchTab: (tabId: string, patch: Partial<Tab>) => void
  activeTab: () => Tab | undefined
}

let pendingConfirm: ((ok: boolean, extra?: ConfirmCloseExtra) => void) | null = null

export const TERM_FONT_MIN = 8
export const TERM_FONT_MAX = 36
export const TERM_FONT_DEFAULT = 15

const LEFT_SIDEBAR_WIDTH = 292
const MIN_MAIN_WIDTH = 360
export const DOCK_WIDTH_MIN = 280
export const DOCK_WIDTH_MAX = 720
const DOCK_WIDTH_DEFAULT = 336

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  sessions: [],
  snippets: [],
  history: [],
  tabs: [],
  activeTabId: null,
  query: '',
  leftTab: 'sessions',
  rightTab: 'snippets',
  rightOpen: true,
  paletteOpen: false,
  editing: null,
  toasts: [],
  confirm: null,
  appearance: readLocalAppearance(),
  termFontSize: readLocalTermFontSize(),
  rightDockWidth: readLocalRightDockWidth(),
  aiDraft: null,
  appVersion: '',
  update: null,
  hydrate: async () => {
    const [sessions, snippets, history, appearance, appVersion, update] = await Promise.all([
      window.duty.sessions.list(),
      window.duty.snippets.list(),
      window.duty.history.list(),
      window.duty.theme.get(),
      window.duty.app.version(),
      window.duty.update.get()
    ])
    paint(appearance)
    set({ sessions, snippets, history, appearance, appVersion, update, ready: true })
  },
  setAppearance: async (appearance) => {
    const next = await window.duty.theme.set(appearance)
    paint(next)
    set({ appearance: next })
  },
  setTermFontSize: (size) => {
    const next = clampTermFontSize(size)
    if (next === get().termFontSize) return
    persistTermFontSize(next)
    set({ termFontSize: next })
  },
  setRightDockWidth: (width) => {
    const next = clampRightDockWidth(width)
    if (next === get().rightDockWidth) return
    persistRightDockWidth(next)
    set({ rightDockWidth: next })
  },
  setQuery: (query) => set({ query }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setRightTab: (rightTab) => set({ rightTab, rightOpen: true }),
  openAi: () => set({ rightOpen: true, rightTab: 'ai' }),
  fillAiDraft: (text) => set({ rightOpen: true, rightTab: 'ai', aiDraft: text }),
  clearAiDraft: () => set({ aiDraft: null }),
  toggleRight: () => set({ rightOpen: !get().rightOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setEditing: (editing) => set({ editing }),
  setUpdate: (update) => set({ update }),
  toast: (message, tone = 'ok') => {
    const id = crypto.randomUUID()
    set({ toasts: [{ id, message, tone }] })
    window.setTimeout(() => {
      set({ toasts: get().toasts.filter((item) => item.id !== id) })
    }, tone === 'err' ? 5200 : 2800)
  },
  askConfirm: (options) => {
    pendingConfirm?.(false)
    return new Promise((resolve) => {
      pendingConfirm = (ok, extra) => {
        if (ok && extra?.sessionAll) options.onSessionAll?.()
        resolve(ok)
      }
      set({
        confirm: {
          title: options.title || '请确认',
          message: options.message,
          ok: options.ok || '确定',
          cancel: options.cancel || '取消',
          danger: options.danger !== false,
          code: options.code,
          sessionAll: Boolean(options.sessionAll || options.onSessionAll)
        }
      })
    })
  },
  closeConfirm: (ok, extra) => {
    const resolve = pendingConfirm
    pendingConfirm = null
    set({ confirm: null })
    resolve?.(ok, extra)
  },
  refreshSessions: async () => set({ sessions: await window.duty.sessions.list() }),
  refreshSnippets: async () => set({ snippets: await window.duty.snippets.list() }),
  refreshHistory: async () => set({ history: await window.duty.history.list() }),
  openSession: (session) => {
    const id = crypto.randomUUID()
    const tab: Tab = {
      id,
      sessionId: session.id,
      title: session.name,
      status: 'connecting'
    }
    set({
      tabs: [...get().tabs, tab],
      activeTabId: id
    })
    return id
  },
  closeTab: async (tabId) => {
    await window.duty.ssh.disconnect(tabId)
    const tabs = get().tabs.filter((tab) => tab.id !== tabId)
    set({
      tabs,
      activeTabId: get().activeTabId === tabId ? tabs.at(-1)?.id || null : get().activeTabId
    })
  },
  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  patchTab: (tabId, patch) =>
    set({
      tabs: get().tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab))
    }),
  activeTab: () => get().tabs.find((tab) => tab.id === get().activeTabId)
}))

export function selectActiveTab(state: AppState) {
  return state.tabs.find((tab) => tab.id === state.activeTabId)
}

function clampTermFontSize(size: number): number {
  return Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, Math.round(size)))
}

function readLocalTermFontSize(): number {
  try {
    const raw = Number(localStorage.getItem('duty-term-font-size'))
    return Number.isFinite(raw) ? clampTermFontSize(raw) : TERM_FONT_DEFAULT
  } catch {
    return TERM_FONT_DEFAULT
  }
}

function persistTermFontSize(size: number): void {
  try {
    localStorage.setItem('duty-term-font-size', String(size))
  } catch {
    /* ignore */
  }
}

export function clampRightDockWidth(width: number, windowWidth = typeof window === 'undefined' ? 1440 : window.innerWidth): number {
  const available = windowWidth - LEFT_SIDEBAR_WIDTH - MIN_MAIN_WIDTH
  const max = Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, available))
  return Math.min(max, Math.max(DOCK_WIDTH_MIN, Math.round(width)))
}

function clampDockWidthHard(width: number): number {
  if (!Number.isFinite(width)) return DOCK_WIDTH_DEFAULT
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, Math.round(width)))
}

function readLocalRightDockWidth(): number {
  try {
    const raw = Number(localStorage.getItem('duty-right-dock-width'))
    return Number.isFinite(raw) ? clampDockWidthHard(raw) : DOCK_WIDTH_DEFAULT
  } catch {
    return DOCK_WIDTH_DEFAULT
  }
}

function persistRightDockWidth(width: number): void {
  try {
    localStorage.setItem('duty-right-dock-width', String(width))
  } catch {
    /* ignore */
  }
}

function readLocalAppearance(): Appearance {
  try {
    return localStorage.getItem('duty-appearance') === 'night' ? 'night' : 'light'
  } catch {
    return 'light'
  }
}

function paint(appearance: Appearance): void {
  document.documentElement.dataset.theme = appearance
  try {
    localStorage.setItem('duty-appearance', appearance)
  } catch {
    /* ignore */
  }
}
