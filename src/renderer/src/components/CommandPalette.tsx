import { useEffect, useMemo, useState } from 'react'
import { selectActiveTab, useApp } from '../store'

export default function CommandPalette() {
  const sessions = useApp((s) => s.sessions)
  const snippets = useApp((s) => s.snippets)
  const history = useApp((s) => s.history)
  const openSession = useApp((s) => s.openSession)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const setEditing = useApp((s) => s.setEditing)
  const activeTab = useApp(selectActiveTab)
  const toast = useApp((s) => s.toast)
  const setAppearance = useApp((s) => s.setAppearance)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows: { id: string; title: string; hint: string; run: () => void }[] = [
      {
        id: 'new',
        title: '登记一台倒霉主机',
        hint: '值班表',
        run: () => setEditing('new')
      },
      {
        id: 'theme-light',
        title: '切到白天白底',
        hint: '风格',
        run: () => void setAppearance('light')
      },
      {
        id: 'theme-night',
        title: '切到夜班风格',
        hint: '风格',
        run: () => void setAppearance('night')
      },
      {
        id: 'ai',
        title: '打开值班助手',
        hint: 'Ctrl Shift A',
        run: () => useApp.getState().openAi()
      },
      {
        id: 'update',
        title: '检查更新',
        hint: '版本',
        run: () => {
          void window.duty.update.check(false)
        }
      }
    ]
    for (const session of sessions) {
      rows.push({
        id: `s-${session.id}`,
        title: `连接 ${session.name}`,
        hint: `${session.username}@${session.host}`,
        run: () => openSession(session)
      })
    }
    for (const snippet of snippets) {
      rows.push({
        id: `p-${snippet.id}`,
        title: snippet.name,
        hint: snippet.command,
        run: () => {
          if (!activeTab || activeTab.status !== 'connected') {
            toast('先连上一个黑窗口', 'err')
            return
          }
          window.duty.ssh.write(activeTab.id, `${snippet.command}\r`)
        }
      })
    }
    for (const command of history.slice(0, 12)) {
      rows.push({
        id: `h-${command}`,
        title: command,
        hint: '历史命令',
        run: () => {
          if (!activeTab || activeTab.status !== 'connected') {
            toast('先连上一个黑窗口', 'err')
            return
          }
          window.duty.ssh.write(activeTab.id, `${command}\r`)
        }
      })
    }
    return rows.filter((row) => `${row.title} ${row.hint}`.toLowerCase().includes(q)).slice(0, 14)
  }, [activeTab, history, openSession, query, sessions, setAppearance, setEditing, snippets, toast])

  useEffect(() => setIndex(0), [query, items.length])

  function run(i = index) {
    items[i]?.run()
    setPaletteOpen(false)
  }

  return (
    <div className="modal-mask" onMouseDown={() => setPaletteOpen(false)}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <input
          className="palette-input"
          autoFocus
          placeholder="搜一下，别让领导看见你在翻"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((current) => Math.min(items.length - 1, current + 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((current) => Math.max(0, current - 1))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              run()
            }
          }}
        />
        <div className="palette-list">
          {items.length === 0 ? <div className="empty">没有匹配项</div> : null}
          {items.map((item, i) => (
            <button
              key={item.id}
              className={`palette-item ${i === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(i)}
            >
              <span className="dock-name">{item.title}</span>
              <span className="dock-meta">{item.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
