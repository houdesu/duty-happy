import { useMemo, useState } from 'react'
import type { SessionPublic } from '../../../shared/types'
import { selectActiveTab, useApp } from '../store'
import FileBrowser from './FileBrowser'

export default function Sidebar() {
  const sessions = useApp((s) => s.sessions)
  const tabs = useApp((s) => s.tabs)
  const query = useApp((s) => s.query)
  const leftTab = useApp((s) => s.leftTab)
  const setQuery = useApp((s) => s.setQuery)
  const setLeftTab = useApp((s) => s.setLeftTab)
  const setEditing = useApp((s) => s.setEditing)
  const openSession = useApp((s) => s.openSession)
  const active = useApp(selectActiveTab)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions.filter((session) => {
      const hay = `${session.name} ${session.host} ${session.username} ${session.group}`.toLowerCase()
      return hay.includes(q)
    })
  }, [query, sessions])

  const groups = useMemo(() => {
    const map = new Map<string, SessionPublic[]>()
    for (const session of filtered) {
      const list = map.get(session.group) || []
      list.push(session)
      map.set(session.group, list)
    }
    return [...map.entries()]
  }, [filtered])

  return (
    <aside className="sidebar">
      <div className="pane-head">
        <div className="pane-title">
          {leftTab === 'files' && active ? `${active.title} 的文件` : '今晚的机器'}
        </div>
        {leftTab === 'sessions' ? (
          <button className="happy-btn" onClick={() => setEditing('new')}>
            新建
          </button>
        ) : (
          <span className="muted">{active?.status === 'connected' ? '已连接' : '未连接'}</span>
        )}
      </div>
      <div className="segment">
        <button className={leftTab === 'sessions' ? 'active' : ''} onClick={() => setLeftTab('sessions')}>
          会话
        </button>
        <button className={leftTab === 'files' ? 'active' : ''} onClick={() => setLeftTab('files')}>
          文件
        </button>
      </div>
      {leftTab === 'sessions' ? (
        <>
          <label className="search">
            <span>⌕</span>
            <input
              value={query}
              placeholder="搜主机、IP，假装你记得住"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="scroll">
          {groups.length === 0 ? (
            <div className="empty">值班室还是空的。先加一台，双击连上去装忙。</div>
          ) : (
            groups.map(([group, items]) => (
              <section key={group}>
                <div className="group-label">{group}</div>
                <div className="session-list">
                {items.map((session) => {
                  const live = tabs.find(
                    (tab) => tab.sessionId === session.id && tab.status === 'connected'
                  )
                  const busy = tabs.find(
                    (tab) => tab.sessionId === session.id && tab.status === 'connecting'
                  )
                  return (
                    <SessionRow
                      key={session.id}
                      session={session}
                      live={Boolean(live)}
                      busy={Boolean(busy)}
                      onOpen={() => openSession(session)}
                      onEdit={() => setEditing(session)}
                    />
                  )
                })}
                </div>
              </section>
            ))
          )}
          </div>
        </>
      ) : (
        <FileBrowser />
      )}
    </aside>
  )
}

function SessionRow({
  session,
  live,
  busy,
  onOpen,
  onEdit
}: {
  session: SessionPublic
  live: boolean
  busy: boolean
  onOpen: () => void
  onEdit: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      className={`session ${live ? 'active' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={onOpen}
    >
      <span className={`dot ${busy ? 'busy' : live ? 'on' : ''}`} />
      <button onClick={onOpen} style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
        <span className="session-name">{session.name}</span>
        <span className="session-meta">
          {session.username}@{session.host}:{session.port}
        </span>
      </button>
      {hover ? (
        <button className="icon-btn" title="编辑" onClick={onEdit}>
          ✎
        </button>
      ) : null}
    </div>
  )
}
