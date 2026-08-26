import { TERM_FONT_MAX, TERM_FONT_MIN, useApp } from '../store'
import TerminalPane from './TerminalPane'

export default function TerminalWorkspace() {
  const tabs = useApp((s) => s.tabs)
  const activeTabId = useApp((s) => s.activeTabId)
  const setActiveTab = useApp((s) => s.setActiveTab)
  const closeTab = useApp((s) => s.closeTab)
  const setEditing = useApp((s) => s.setEditing)
  const termFontSize = useApp((s) => s.termFontSize)
  const setTermFontSize = useApp((s) => s.setTermFontSize)

  return (
    <main className="main">
      <div className="tabs">
        <div className="tab-strip">
          {tabs.length === 0 ? <div className="muted tab-empty">黑窗口待命中</div> : null}
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
              title={tab.title}
              onClick={() => setActiveTab(tab.id)}
            >
              <span
                className={`dot ${tab.status === 'connected' ? 'on' : tab.status === 'connecting' ? 'busy' : 'off'}`}
              />
              <span className="session-name">{tab.title}</span>
              <span
                className="tab-close"
                title="关闭会话"
                role="button"
                onClick={(event) => {
                  event.stopPropagation()
                  void closeTab(tab.id)
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
        <div className="term-font-tools" title="Ctrl + 滚轮也可调字号">
          <button
            type="button"
            className="term-font-btn"
            disabled={termFontSize <= TERM_FONT_MIN}
            aria-label="缩小终端字号"
            onClick={() => setTermFontSize(termFontSize - 1)}
          >
            A−
          </button>
          <span className="term-font-size">{termFontSize}</span>
          <button
            type="button"
            className="term-font-btn term-font-btn-lg"
            disabled={termFontSize >= TERM_FONT_MAX}
            aria-label="放大终端字号"
            onClick={() => setTermFontSize(termFontSize + 1)}
          >
            A+
          </button>
        </div>
      </div>
      <div className="term-stage">
        {tabs.length === 0 ? (
          <div className="welcome">
            <div>
              <div className="kicker">今晚也要快乐哦</div>
              <h1>告警还没来，先把机器加上</h1>
              <p className="muted">双击就能 SSH。文件、常用命令、历史敲过的坑，都堆在旁边。</p>
              <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center', gap: 8 }}>
                <button className="happy-btn" onClick={() => setEditing('new')}>
                  添加一台倒霉主机
                </button>
              </div>
              <div className="hint-grid">
                <div className="hint">
                  <b>
                    <span className="kbd">Ctrl</span> + <span className="kbd">K</span>
                  </b>
                  <span>半夜手抖时，搜会话比翻列表快</span>
                </div>
                <div className="hint">
                  <b>
                    <span className="kbd">Ctrl</span> + <span className="kbd">N</span>
                  </b>
                  <span>新建主机，密码锁在这台电脑里</span>
                </div>
                <div className="hint">
                  <b>值班助手</b>
                  <span>右侧「值班助手」能问答，也能开 Agent 自己跑命令</span>
                </div>
                <div className="hint">
                  <b>文件不用另开窗</b>
                  <span>连上后左边切「文件」，上传下载继续装忙</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          tabs.map((tab) => (
            <div
              key={tab.id}
              className="term-host"
              style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
            >
              <TerminalPane tab={tab} active={tab.id === activeTabId} />
            </div>
          ))
        )}
      </div>
    </main>
  )
}
