import { useEffect, useState } from 'react'
import type { SessionInput, SessionPublic } from '../../../shared/types'
import { useApp } from '../store'

const empty: SessionInput = {
  name: '',
  host: '',
  port: 22,
  username: 'root',
  auth: 'password',
  group: '默认'
}

export default function SessionModal() {
  const editing = useApp((s) => s.editing)
  const setEditing = useApp((s) => s.setEditing)
  const refreshSessions = useApp((s) => s.refreshSessions)
  const toast = useApp((s) => s.toast)
  const [form, setForm] = useState<SessionInput>(empty)

  useEffect(() => {
    if (editing === 'new') setForm(empty)
    else if (editing) {
      setForm({
        id: editing.id,
        name: editing.name,
        host: editing.host,
        port: editing.port,
        username: editing.username,
        auth: editing.auth,
        privateKeyPath: editing.privateKeyPath,
        group: editing.group
      })
    }
  }, [editing])

  if (!editing) return null
  const session = editing === 'new' ? null : editing

  function update<K extends keyof SessionInput>(key: K, value: SessionInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function pickKey() {
    const result = await window.duty.sessions.pickKey()
    if (result.ok && result.data) update('privateKeyPath', result.data)
  }

  async function save() {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      toast('名称、主机和用户名不能为空', 'err')
      return
    }
    await window.duty.sessions.upsert({
      ...form,
      name: form.name.trim(),
      host: form.host.trim()
    })
    await refreshSessions()
    setEditing(null)
    toast('会话已保存')
  }

  async function remove() {
    if (!session) return
    const ok = await useApp.getState().askConfirm({
      title: '删除会话',
      message: `确定删除 ${session.name}？从值班表拿掉。`,
      ok: '删除',
      danger: true
    })
    if (!ok) return
    await window.duty.sessions.delete(session.id)
    await refreshSessions()
    setEditing(null)
    toast('已删除')
  }

  return (
    <div className="modal-mask" onMouseDown={() => setEditing(null)}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="kicker">{session ? '改这台' : '新的倒霉主机'}</div>
        <h2 style={{ margin: '0 0 18px', fontWeight: 800 }}>
          {session ? session.name : '登记进值班表'}
        </h2>
        <div className="form-grid">
          <label className="field">
            <span>显示名称</span>
            <input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="web01" />
          </label>
          <label className="field">
            <span>分组</span>
            <input value={form.group || ''} onChange={(e) => update('group', e.target.value)} placeholder="生产" />
          </label>
          <label className="field">
            <span>主机</span>
            <input value={form.host} onChange={(e) => update('host', e.target.value)} placeholder="10.0.0.223" />
          </label>
          <label className="field">
            <span>端口</span>
            <input
              type="number"
              value={form.port}
              onChange={(e) => update('port', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>用户名</span>
            <input value={form.username} onChange={(e) => update('username', e.target.value)} />
          </label>
          <label className="field">
            <span>认证方式</span>
            <select value={form.auth} onChange={(e) => update('auth', e.target.value as SessionInput['auth'])}>
              <option value="password">密码</option>
              <option value="key">私钥</option>
            </select>
          </label>
          {form.auth === 'password' ? (
            <label className="field span-2">
              <span>{session?.hasPassword ? '密码（留空则保持原密码）' : '密码'}</span>
              <input
                type="password"
                value={form.password || ''}
                onChange={(e) => update('password', e.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="field span-2">
                <span>私钥文件</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={{ flex: 1 }}
                    value={form.privateKeyPath || ''}
                    placeholder="C:\\Users\\...\\id_rsa"
                    onChange={(e) => update('privateKeyPath', e.target.value)}
                  />
                  <button className="ghost" onClick={() => void pickKey()}>
                    选择
                  </button>
                </div>
              </label>
              <label className="field span-2">
                <span>密钥口令（可选）</span>
                <input
                  type="password"
                  value={form.passphrase || ''}
                  onChange={(e) => update('passphrase', e.target.value)}
                />
              </label>
            </>
          )}
        </div>
        <div className="modal-actions">
          {session ? (
            <button className="ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => void remove()}>
              删除
            </button>
          ) : null}
          <button className="ghost" onClick={() => setEditing(null)}>
            取消
          </button>
          <button className="happy-btn" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
