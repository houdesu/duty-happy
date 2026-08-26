import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { Tab } from '../store'
import { useApp } from '../store'
import { TERM_FONT_FAMILY, TERM_THEMES } from '../lib/term-themes'
import { appendTerm, dropTerm } from '../lib/term-log'

const ASK_MAX = 8000

export default function TerminalPane({ tab, active }: { tab: Tab; active: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const started = useRef(false)
  const [askBar, setAskBar] = useState<{ left: number; top: number; text: string } | null>(null)
  const patchTab = useApp((s) => s.patchTab)
  const toast = useApp((s) => s.toast)
  const appearance = useApp((s) => s.appearance)
  const termFontSize = useApp((s) => s.termFontSize)
  const fillAiDraft = useApp((s) => s.fillAiDraft)

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      cursorInactiveStyle: 'outline',
      fontFamily: TERM_FONT_FAMILY,
      fontSize: useApp.getState().termFontSize,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.4,
      minimumContrastRatio: 4.5,
      drawBoldTextInBrightColors: true,
      wordSeparator: ' ()[]{}\'",;:：；、，',
      scrollback: 8000,
      smoothScrollDuration: 80,
      theme: TERM_THEMES[useApp.getState().appearance]
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    termRef.current = term
    fitRef.current = fit
    if (wrapRef.current) term.open(wrapRef.current)
    fit.fit()

    let buffer = ''
    const offData = window.duty.ssh.onData(({ tabId, data }) => {
      if (tabId !== tab.id) return
      const chunk = toWrite(data)
      term.write(chunk)
      appendTerm(tab.id, decodeChunk(chunk))
    })
    const disposable = term.onData((data) => {
      window.duty.ssh.write(tab.id, data)
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          const command = buffer.trim()
          buffer = ''
          if (command) void window.duty.history.add(command).then((history) => useApp.setState({ history }))
        } else if (ch === '\u007f' || ch === '\b') {
          buffer = buffer.slice(0, -1)
        } else if (ch >= ' ') {
          buffer += ch
        } else {
          buffer = ''
        }
      }
    })
    const sel = term.onSelectionChange(() => {
      if (!term.hasSelection()) setAskBar(null)
    })
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const copy =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 'c' &&
        term.hasSelection()
      if (copy) {
        void writeClipboard(term.getSelection())
        return false
      }
      if (term.hasSelection() && !isHoldKey(event)) {
        term.clearSelection()
        setAskBar(null)
        collapseXtermTextarea(wrapRef.current)
      }
      return true
    })

    const observer = new ResizeObserver(() => {
      fit.fit()
      window.duty.ssh.resize(tab.id, term.cols, term.rows)
    })
    if (wrapRef.current) observer.observe(wrapRef.current)
    const viewport = wrapRef.current?.querySelector('.xterm-viewport')
    const hideAsk = () => setAskBar(null)
    viewport?.addEventListener('scroll', hideAsk)
    term.attachCustomWheelEventHandler((event) => !(event.ctrlKey || event.metaKey))
    const wrap = wrapRef.current
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      if (event.deltaY === 0) return
      const next = useApp.getState().termFontSize + (event.deltaY < 0 ? 1 : -1)
      useApp.getState().setTermFontSize(next)
    }
    wrap?.addEventListener('wheel', onWheel, { passive: false, capture: true })

    return () => {
      offData()
      disposable.dispose()
      sel.dispose()
      viewport?.removeEventListener('scroll', hideAsk)
      wrap?.removeEventListener('wheel', onWheel, true)
      observer.disconnect()
      term.dispose()
      termRef.current = null
      dropTerm(tab.id)
    }
  }, [tab.id])

  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = TERM_THEMES[appearance]
  }, [appearance])

  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || term.options.fontSize === termFontSize) return
    term.options.fontSize = termFontSize
    if (!active || !fit) return
    fit.fit()
    window.duty.ssh.resize(tab.id, term.cols, term.rows)
  }, [termFontSize, active, tab.id])

  useEffect(() => {
    if (!active) setAskBar(null)
  }, [active])

  useEffect(() => {
    if (started.current) return
    started.current = true
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    fit.fit()
    void (async () => {
      const result = await window.duty.ssh.connect({
        tabId: tab.id,
        sessionId: tab.sessionId,
        cols: term.cols,
        rows: term.rows
      })
      if (!result.ok) {
        patchTab(tab.id, { status: 'error', error: result.error })
        toast(result.error || '连接失败', 'err')
        term.writeln(`\r\n\x1b[31m连接失败：${result.error || '未知错误'}\x1b[0m`)
      }
    })()
  }, [patchTab, tab.id, tab.sessionId, toast])

  useEffect(() => {
    if (!active) return
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    fit.fit()
    term.focus()
    window.duty.ssh.resize(tab.id, term.cols, term.rows)
  }, [active, tab.id])

  function placeAskBar(event: { clientX: number; clientY: number }) {
    const term = termRef.current
    const wrap = wrapRef.current
    if (!term || !wrap) return
    const { clientX, clientY } = event
    window.setTimeout(() => {
      const text = term.getSelection().trim()
      if (!text) {
        setAskBar(null)
        return
      }
      const rect = wrap.getBoundingClientRect()
      const left = Math.min(Math.max(8, clientX - rect.left), Math.max(8, rect.width - 220))
      const top = Math.min(Math.max(8, clientY - rect.top + 12), Math.max(8, rect.height - 48))
      setAskBar({ left, top, text: text.slice(0, ASK_MAX) })
      term.focus()
    }, 0)
  }

  async function copyAsk() {
    if (!askBar) return
    const ok = await writeClipboard(askBar.text)
    toast(ok ? '已复制' : '复制失败', ok ? 'ok' : 'err')
    setAskBar(null)
  }

  function callAssistant() {
    if (!askBar) return
    fillAiDraft(askBar.text)
    setAskBar(null)
    termRef.current?.clearSelection()
  }

  async function reconnect() {
    const term = termRef.current
    if (!term) return
    patchTab(tab.id, { status: 'connecting', error: undefined })
    const result = await window.duty.ssh.connect({
      tabId: tab.id,
      sessionId: tab.sessionId,
      cols: term.cols,
      rows: term.rows
    })
    if (!result.ok) {
      patchTab(tab.id, { status: 'error', error: result.error })
      toast(result.error || '重连失败', 'err')
    }
  }

  return (
    <div className="term-wrap">
      <div
        ref={wrapRef}
        className="term-xterm"
        onMouseDown={() => setAskBar(null)}
        onMouseUp={placeAskBar}
      />
      {askBar ? (
        <div
          className="term-ask"
          style={{ left: askBar.left, top: askBar.top }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" className="ghost" tabIndex={-1} onClick={() => void copyAsk()}>
            复制
          </button>
          <button type="button" className="happy-btn" tabIndex={-1} onClick={callAssistant}>
            呼叫助手
          </button>
        </div>
      ) : null}
      {tab.status === 'connecting' ? (
        <div className="overlay">
          <div>
            <div className="kicker">正在钻进机房</div>
            <h2>{tab.title}</h2>
          </div>
        </div>
      ) : null}
      {tab.status === 'closed' || tab.status === 'error' ? (
        <div className="overlay">
          <div>
            <div className="kicker">{tab.status === 'error' ? '这台今天不给面子' : '它把你踢了'}</div>
            <h2>{tab.error || tab.title}</h2>
            <div style={{ marginTop: 16 }}>
              <button className="happy-btn" onClick={() => void reconnect()}>
                再快乐一次
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function isHoldKey(event: KeyboardEvent): boolean {
  return (
    event.key === 'Shift' ||
    event.key === 'Control' ||
    event.key === 'Meta' ||
    event.key === 'Alt' ||
    event.key === 'CapsLock'
  )
}

function collapseXtermTextarea(wrap: HTMLDivElement | null): void {
  const textarea = wrap?.querySelector('textarea')
  if (!textarea) return
  const end = textarea.value.length
  textarea.setSelectionRange(end, end)
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.left = '-9999px'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  }
}

function decodeChunk(data: string | Uint8Array): string {
  if (typeof data === 'string') return data
  return new TextDecoder().decode(data)
}

function toWrite(data: Uint8Array | { type?: string; data?: number[] } | string): string | Uint8Array {
  if (typeof data === 'string' || data instanceof Uint8Array) return data
  if (data?.data) return Uint8Array.from(data.data)
  return String(data)
}
