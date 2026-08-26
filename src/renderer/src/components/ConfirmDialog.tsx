import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'

const PREVIEW_LINES = 10
const PREVIEW_CHARS = 400

export default function ConfirmDialog() {
  const confirm = useApp((s) => s.confirm)
  const closeConfirm = useApp((s) => s.closeConfirm)
  const okRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setExpanded(false)
  }, [confirm])

  useEffect(() => {
    if (!confirm) return
    okRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeConfirm(false)
        return
      }
      if (event.key === 'Enter') {
        const target = event.target as HTMLElement | null
        if (target?.closest('button') && target !== okRef.current) return
        event.preventDefault()
        event.stopImmediatePropagation()
        closeConfirm(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm, closeConfirm])

  if (!confirm) return null

  const code = confirm.code || ''
  const message = confirm.message.trim()
  const foldSource = code || message
  const folded = Boolean(foldSource) && needsFold(foldSource)
  const shown = folded && !expanded ? previewText(foldSource) : foldSource

  return (
    <div className="modal-mask confirm-mask" onMouseDown={() => closeConfirm(false)}>
      <div
        className={`modal confirm${code ? ' has-code' : ''}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-head">
          <div className="kicker">{confirm.danger ? '危险操作' : '请确认'}</div>
          <h2 className="confirm-title">{confirm.title}</h2>
        </div>
        <div className="confirm-body">
          {code ? (
            <>
              {message ? <p className="confirm-msg">{message}</p> : null}
              <div className="confirm-code">
                <pre>{folded && !expanded ? `${shown}\n…` : shown}</pre>
                {folded ? (
                  <button type="button" className="confirm-fold" onClick={() => setExpanded((open) => !open)}>
                    {expanded ? '收起' : '展开全部'}
                  </button>
                ) : null}
              </div>
            </>
          ) : message ? (
            <div className="confirm-msg-wrap">
              <p className="confirm-msg">{folded && !expanded ? `${shown}…` : shown}</p>
              {folded ? (
                <button type="button" className="confirm-fold" onClick={() => setExpanded((open) => !open)}>
                  {expanded ? '收起' : '展开全部'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="confirm-actions">
          {confirm.sessionAll ? (
            <button
              type="button"
              className="ghost confirm-session-all"
              onClick={() => closeConfirm(true, { sessionAll: true })}
            >
              本次会话全部同意执行
            </button>
          ) : null}
          <button type="button" className="ghost" onClick={() => closeConfirm(false)}>
            {confirm.cancel}
          </button>
          <button
            ref={okRef}
            type="button"
            className={confirm.danger ? 'danger-btn' : 'happy-btn'}
            onClick={() => closeConfirm(true)}
          >
            {confirm.ok}
          </button>
        </div>
      </div>
    </div>
  )
}

function needsFold(text: string): boolean {
  return text.length > PREVIEW_CHARS || text.split(/\r?\n/).length > PREVIEW_LINES
}

function previewText(text: string): string {
  const lines = text.split(/\r?\n/)
  if (lines.length > PREVIEW_LINES) return lines.slice(0, PREVIEW_LINES).join('\n')
  if (text.length > PREVIEW_CHARS) return text.slice(0, PREVIEW_CHARS)
  return text
}
