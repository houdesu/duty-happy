import type { AppUpdateStatus } from '../../../shared/types'
import { selectActiveTab, useApp } from '../store'

export default function TitleBar() {
  const tabs = useApp((s) => s.tabs)
  const active = useApp(selectActiveTab)
  const appearance = useApp((s) => s.appearance)
  const setAppearance = useApp((s) => s.setAppearance)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const toggleRight = useApp((s) => s.toggleRight)
  const openAi = useApp((s) => s.openAi)
  const appVersion = useApp((s) => s.appVersion)
  const update = useApp((s) => s.update)
  const connected = tabs.filter((tab) => tab.status === 'connected').length
  const chip = updateChip(appVersion, update)

  return (
    <header className="titlebar">
      <div className="brand">
        <span className="brand-badge">值</span>
        <span className="brand-mark">值班快乐机</span>
        <button
          type="button"
          className={`ver-chip no-drag${chip.hot ? ' is-hot' : ''}`}
          title={chip.hint}
          onClick={() => void onUpdateClick(update)}
        >
          {chip.label}
        </button>
      </div>
      <span className="mood">{connected > 0 ? `在线 ${connected} 台，表面还行` : '今晚暂无事故'}</span>
      <div className="muted" style={{ fontSize: 12 }}>
        {active ? `${active.title} · ${statusLabel(active.status)}` : '还没人喊你'}
      </div>
      <div style={{ flex: 1 }} />
      <div className="theme-switch no-drag">
        <button
          className={appearance === 'light' ? 'active' : ''}
          onClick={() => void setAppearance('light')}
        >
          白天
        </button>
        <button
          className={appearance === 'night' ? 'active' : ''}
          onClick={() => void setAppearance('night')}
        >
          夜班
        </button>
      </div>
      <button className="ghost no-drag" onClick={() => setPaletteOpen(true)}>
        找东西 <span className="kbd">Ctrl K</span>
      </button>
      <button className="ghost no-drag" onClick={openAi}>
        值班助手
      </button>
      <button className="ghost no-drag" onClick={toggleRight}>
        侧栏
      </button>
    </header>
  )
}

function statusLabel(status: string): string {
  if (status === 'connected') return '连上了'
  if (status === 'connecting') return '正在钻进去'
  if (status === 'error') return '寄了'
  return '掉线了'
}

function updateChip(appVersion: string, update: AppUpdateStatus | null) {
  const version = appVersion || update?.currentVersion || ''
  const ver = version ? `v${version}` : '版本'
  if (update?.phase === 'checking') return { label: '在查更新', hint: '正在检查更新', hot: false }
  if (update?.phase === 'downloading') {
    return { label: `更新 ${update.percent ?? 0}%`, hint: '正在下载更新', hot: true }
  }
  if (update?.phase === 'ready') return { label: '重启更新', hint: '下载完了，点一下重启', hot: true }
  if (update?.phase === 'available') {
    return { label: `有 ${update.version}`, hint: '有新版本', hot: true }
  }
  return { label: ver, hint: '检查更新', hot: false }
}

async function onUpdateClick(update: AppUpdateStatus | null): Promise<void> {
  if (update?.phase === 'downloading') return
  if (update?.phase === 'ready') {
    void window.duty.update.install()
    return
  }
  await window.duty.update.check(false)
}
