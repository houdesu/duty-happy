import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { clampRightDockWidth, DOCK_WIDTH_MAX, DOCK_WIDTH_MIN, selectActiveTab, useApp } from '../store'
import AiPanel from './AiPanel'

export default function RightDock() {
  const snippets = useApp((s) => s.snippets)
  const history = useApp((s) => s.history)
  const activeTab = useApp(selectActiveTab)
  const refreshSnippets = useApp((s) => s.refreshSnippets)
  const refreshHistory = useApp((s) => s.refreshHistory)
  const toast = useApp((s) => s.toast)
  const mode = useApp((s) => s.rightTab)
  const setMode = useApp((s) => s.setRightTab)
  const setRightDockWidth = useApp((s) => s.setRightDockWidth)
  const rightDockWidth = useApp((s) => s.rightDockWidth)
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftCommand, setDraftCommand] = useState('')
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const live = activeTab?.status === 'connected'

  const groups = useMemo(() => {
    const map = new Map<string, typeof snippets>()
    for (const snippet of snippets) {
      const list = map.get(snippet.group) || []
      list.push(snippet)
      map.set(snippet.group, list)
    }
    return [...map.entries()]
  }, [snippets])

  function send(command: string, execute = true) {
    const tab = selectActiveTab(useApp.getState())
    if (!tab || tab.status !== 'connected') {
      toast('先连上一个终端，再按救命按钮', 'err')
      return
    }
    const payload = command
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(execute ? '\r' : '; ')
    window.duty.ssh.write(tab.id, execute ? `${payload}\r` : payload)
    if (execute) void window.duty.history.add(command).then((history) => useApp.setState({ history }))
    toast(execute ? '已经丢进终端' : '已经插入，自己按回车')
  }

  async function addSnippet() {
    const name = draftName.trim()
    const command = draftCommand.trim()
    if (!name || !command) {
      toast('名称和命令都要填', 'err')
      return
    }
    await window.duty.snippets.upsert({
      id: crypto.randomUUID(),
      name,
      command,
      group: '自定义'
    })
    await refreshSnippets()
    setDraftName('')
    setDraftCommand('')
    setAdding(false)
    toast('救命按钮已加上')
  }

  function onResizeStart(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = {
      startX: event.clientX,
      startWidth: clampRightDockWidth(rightDockWidth)
    }
    setResizing(true)
    document.body.classList.add('is-resizing-dock')

    const onMove = (move: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      setRightDockWidth(drag.startWidth + (drag.startX - move.clientX))
    }
    const onUp = () => {
      dragRef.current = null
      setResizing(false)
      document.body.classList.remove('is-resizing-dock')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    return () => document.body.classList.remove('is-resizing-dock')
  }, [])

  async function clear() {
    await window.duty.history.clear()
    await refreshHistory()
  }

  return (
    <aside className="dock">
      <div
        className={`dock-resizer ${resizing ? 'is-active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整右侧栏宽度"
        title="拖动调整宽度"
        aria-valuemin={DOCK_WIDTH_MIN}
        aria-valuemax={DOCK_WIDTH_MAX}
        aria-valuenow={clampRightDockWidth(rightDockWidth)}
        onMouseDown={onResizeStart}
      />
      <div className="pane-head">
        <div className="pane-title">
          {mode === 'ai' ? '值班助手' : live ? '救命按钮' : '救命按钮（先连终端）'}
        </div>
        {mode === 'snippets' ? (
          <button className="ghost" onClick={() => setAdding((value) => !value)}>
            {adding ? '取消' : '添加'}
          </button>
        ) : mode === 'history' ? (
          <button className="ghost" onClick={() => void clear()}>
            清空
          </button>
        ) : null}
      </div>
      <div className="segment segment-3">
        <button className={mode === 'snippets' ? 'active' : ''} onClick={() => setMode('snippets')}>
          片段
        </button>
        <button className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}>
          历史
        </button>
        <button className={mode === 'ai' ? 'active' : ''} onClick={() => setMode('ai')}>
        值班助手
        </button>
      </div>
      {adding && mode === 'snippets' ? (
        <form
          className="snippet-form"
          onSubmit={(event) => {
            event.preventDefault()
            void addSnippet()
          }}
        >
          <input
            autoFocus
            value={draftName}
            placeholder="名称，比如 重启 Nginx"
            onChange={(event) => setDraftName(event.target.value)}
          />
          <textarea
            value={draftCommand}
            placeholder="要丢进终端的命令"
            rows={3}
            onChange={(event) => setDraftCommand(event.target.value)}
          />
          <button type="submit" className="happy-btn">
            保存
          </button>
        </form>
      ) : null}
      {mode === 'ai' ? (
        <AiPanel />
      ) : (
        <div className="scroll">
          {mode === 'snippets'
            ? groups.map(([group, items]) => (
                <section key={group}>
                  <div className="group-label">{group}</div>
                  {items.map((snippet) => (
                    <button
                      key={snippet.id}
                      className={`dock-item ${live ? '' : 'is-disabled'}`}
                      title="单击执行，右键插入不执行"
                      onClick={() => send(snippet.command, true)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        send(snippet.command, false)
                      }}
                    >
                      <span className="dock-name">{snippet.name}</span>
                      <span className="dock-meta">{snippet.command}</span>
                    </button>
                  ))}
                </section>
              ))
            : history.length === 0
              ? <div className="empty">你还没在这里闯过祸。敲过的命令会躺在这儿。</div>
              : history.map((command) => (
                  <button key={command} className="dock-item" onClick={() => send(command, true)}>
                    <span className="dock-name">{command}</span>
                  </button>
                ))}
        </div>
      )}
    </aside>
  )
}
