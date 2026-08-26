import { useEffect, useState, type CSSProperties } from 'react'
import type { AppUpdateStatus } from '../../shared/types'
import { clampRightDockWidth, useApp } from './store'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import TerminalWorkspace from './components/TerminalWorkspace'
import RightDock from './components/RightDock'
import ConfirmDialog from './components/ConfirmDialog'
import SessionModal from './components/SessionModal'
import CommandPalette from './components/CommandPalette'

export default function App() {
  const hydrate = useApp((s) => s.hydrate)
  const rightOpen = useApp((s) => s.rightOpen)
  const rightDockWidth = useApp((s) => s.rightDockWidth)
  const paletteOpen = useApp((s) => s.paletteOpen)
  const [viewportW, setViewportW] = useState(() => window.innerWidth)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const setEditing = useApp((s) => s.setEditing)
  const toggleRight = useApp((s) => s.toggleRight)
  const toasts = useApp((s) => s.toasts)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    const seen = new Set<string>()
    const off = window.duty.update.onStatus((status) => {
      useApp.getState().setUpdate(status)
      void reactToUpdate(status, seen)
    })
    return off
  }, [])

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault()
        setPaletteOpen(!useApp.getState().paletteOpen)
      }
      if ((event.ctrlKey || event.metaKey) && key === 'n') {
        event.preventDefault()
        setEditing('new')
      }
      if ((event.ctrlKey || event.metaKey) && key === 'b') {
        event.preventDefault()
        toggleRight()
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'a') {
        event.preventDefault()
        useApp.getState().openAi()
      }
      if (key === 'escape') {
        if (useApp.getState().confirm) return
        setPaletteOpen(false)
        setEditing(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setEditing, setPaletteOpen, toggleRight])

  useEffect(() => {
    const offStatus = window.duty.ssh.onStatus(({ tabId, status }) => {
      if (status === 'connected' || status === 'closed' || status === 'error') {
        useApp.getState().patchTab(tabId, { status })
      }
    })
    const offReady = window.duty.sftp.onReady(({ tabId, path }) => {
      useApp.getState().patchTab(tabId, { cwd: path })
    })
    return () => {
      offStatus()
      offReady()
    }
  }, [])

  return (
    <div className={`app ${rightOpen ? '' : 'workspace-wrap'}`}>
      <TitleBar />
      <div
        className={`workspace ${rightOpen ? '' : 'right-collapsed'}`}
        style={{ '--dock-width': `${clampRightDockWidth(rightDockWidth, viewportW)}px` } as CSSProperties}
      >
        <Sidebar />
        <TerminalWorkspace />
        {rightOpen ? <RightDock /> : <div />}
      </div>
      <SessionModal />
      <ConfirmDialog />
      {paletteOpen ? <CommandPalette /> : null}
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  )
}

async function reactToUpdate(status: AppUpdateStatus, seen: Set<string>): Promise<void> {
  const { toast, askConfirm } = useApp.getState()
  if (status.phase === 'available') {
    const key = `available:${status.version}:${status.quiet}`
    if (seen.has(key)) return
    seen.add(key)
    const ok = await askConfirm({
      title: '有新版本',
      message: `值班快乐机 ${status.version} 已经出来了，现在下？`,
      ok: '下载',
      cancel: '以后再说',
      danger: false
    })
    if (ok) void window.duty.update.download()
    return
  }
  if (status.phase === 'ready') {
    const key = `ready:${status.version}`
    if (seen.has(key)) return
    seen.add(key)
    const ok = await askConfirm({
      title: '更新下好了',
      message: `新版本 ${status.version} 已经下完。重启换上？下次退出也会自动装。`,
      ok: '重启更新',
      cancel: '先不关',
      danger: false
    })
    if (ok) void window.duty.update.install()
    else toast('行，下次退出时会装上')
    return
  }
  if (status.quiet) return
  if (status.phase === 'unavailable') toast('已经是最新，今晚可以安心值班')
  if (status.phase === 'unsupported') toast(status.message || '这边不能自动更新', 'err')
  if (status.phase === 'error') toast(friendlyUpdateError(status.message), 'err')
}

function friendlyUpdateError(message?: string): string {
  const raw = (message || '').toLowerCase()
  if (!raw) return '更新没查到，可能是网络或发布地址'
  if (raw.includes('enotfound') || raw.includes('econn') || raw.includes('net::')) {
    return '更新地址连不上。把 electron-builder.yml 里的 publish.url 改成你放安装包的目录'
  }
  if (raw.includes('404') || raw.includes('not found')) {
    return '还没找到新包。确认发布目录里有 latest.yml 和 setup 安装包'
  }
  return message || '更新没查到'
}
