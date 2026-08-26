import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { FileEntry } from '../../../shared/types'
import { explainFsError } from '../lib/fs-error'
import { selectActiveTab, useApp } from '../store'

interface ClipItem {
  path: string
  name: string
  isDir: boolean
}

interface Clip {
  tabId: string
  items: ClipItem[]
  mode: 'copy' | 'move'
}

interface MenuState {
  x: number
  y: number
  entry: FileEntry | null
  targets: FileEntry[]
}

export default function FileBrowser() {
  const tab = useApp(selectActiveTab)
  const patchTab = useApp((s) => s.patchTab)
  const toast = useApp((s) => s.toast)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [clip, setClip] = useState<Clip | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const listed = useRef('')
  const crumbRef = useRef<HTMLElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)

  const cwd = tab?.cwd || '/'
  const ready = tab?.status === 'connected'
  const parent = cwd === '/' ? '/' : cwd.replace(/\/[^/]+$/, '') || '/'

  async function load(path = cwd) {
    if (!tab || !ready) return
    setLoading(true)
    const result = await window.duty.sftp.list(tab.id, path)
    setLoading(false)
    if (!result.ok) {
      toast(explainFsError('list', path, result.error), 'err')
      return
    }
    setFiles(result.data || [])
    setSelected([])
    setAnchor(null)
    listed.current = path
    if (path !== tab.cwd) patchTab(tab.id, { cwd: path })
  }

  useEffect(() => {
    listed.current = ''
  }, [tab?.id])

  useEffect(() => {
    if (ready && tab?.cwd && listed.current !== tab.cwd) void load(tab.cwd)
    if (!ready) {
      setFiles([])
      setSelected([])
      setAnchor(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id, tab?.status, tab?.cwd])

  useEffect(() => {
    const el = crumbRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
  }, [cwd, files.length])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return files.filter((file) => {
      if (!showHidden && file.name.startsWith('.')) return false
      if (q && !file.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [files, filter, showHidden])

  const hiddenCount = files.filter((file) => file.name.startsWith('.')).length
  const selectedEntries = files.filter((file) => selected.includes(file.path))
  const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : undefined
  const downloadLabel =
    downloading ? '下载中' : selectedEntries.length === 1 && selectedEntries[0].isDir ? '下载文件夹' : '下载'

  async function upload(destDir = cwd) {
    if (!tab) return
    setMenu(null)
    const result = await window.duty.sftp.upload(tab.id, destDir)
    if (!result || result.canceled) return
    if (!result.ok) toast(explainFsError('upload', destDir, result.error), 'err')
    else {
      toast(uploadDone(destDir, result.count))
      void load(cwd)
    }
  }

  async function dropFiles(fileList: FileList) {
    if (!tab || fileList.length === 0) return
    const localPaths = [...fileList].map((file) => window.duty.files.pathOf(file)).filter(Boolean)
    if (localPaths.length === 0) {
      toast('没拿到本地路径，改用上传按钮', 'err')
      return
    }
    toast(`正在上传到 ${cwd}`)
    const result = await window.duty.sftp.uploadPaths(tab.id, cwd, localPaths)
    if (!result.ok) toast(explainFsError('upload', cwd, result.error), 'err')
    else {
      toast(uploadDone(cwd, localPaths.length))
      void load(cwd)
    }
  }

  async function mkdir() {
    if (!tab) return
    const name = newName.trim()
    if (!name) return
    const path = cwd === '/' ? `/${name}` : `${cwd}/${name}`
    const result = await window.duty.sftp.mkdir(tab.id, path)
    if (!result.ok) toast(explainFsError('mkdir', path, result.error), 'err')
    else {
      setCreating(false)
      setNewName('')
      void load(cwd)
    }
  }

  async function openEntry(entry: FileEntry) {
    if (!tab) return
    if (entry.isDir) {
      void load(entry.path)
      return
    }
    void downloadEntries([entry])
  }

  async function downloadEntries(entries: FileEntry[]) {
    if (!tab || entries.length === 0 || downloading) return
    setMenu(null)
    setDownloading(true)
    toast(entries.length === 1 ? `正在下载 ${entries[0].name}` : `正在下载 ${entries.length} 项`)
    const result = await window.duty.sftp.download(
      tab.id,
      entries.map((entry) => ({ path: entry.path, isDir: entry.isDir }))
    )
    setDownloading(false)
    if (!result || result.canceled) {
      if (result?.error === '已取消下载') toast('已取消下载')
      return
    }
    if (!result.ok) toast(explainFsError('download', entries[0].path, result.error), 'err')
    else if (entries.length === 1) toast(`已保存 ${entries[0].name}`)
    else toast(`已下载 ${result.count || entries.length} 项`)
  }

  async function remove(entries: FileEntry[]) {
    if (!tab || entries.length === 0) return
    const names = entries.map((entry) => entry.name)
    const preview = names.slice(0, 6).join('、')
    const extra = names.length > 6 ? '…' : ''
    const ok = await useApp.getState().askConfirm({
      title: entries.length === 1 ? '删除文件' : '删除所选',
      message:
        entries.length === 1
          ? `确定删除 ${names[0]}？删了就没了。`
          : `确定删除这 ${entries.length} 项（${preview}${extra}）？删了就没了。`,
      ok: '删除',
      danger: true
    })
    if (!ok) return
    for (const entry of entries) {
      const result = await window.duty.sftp.remove(tab.id, entry.path, entry.isDir)
      if (!result.ok) {
        toast(explainFsError('delete', entry.path, result.error), 'err')
        void load(cwd)
        return
      }
    }
    const removed = new Set(entries.map((entry) => entry.path))
    if (clip?.items.some((item) => removed.has(item.path))) {
      const next = clip.items.filter((item) => !removed.has(item.path))
      setClip(next.length ? { ...clip, items: next } : null)
    }
    setSelected([])
    setAnchor(null)
    void load(cwd)
  }

  function mark(entries: FileEntry[], mode: 'copy' | 'move') {
    if (!tab || entries.length === 0) return
    setClip({
      tabId: tab.id,
      items: entries.map((entry) => ({ path: entry.path, name: entry.name, isDir: entry.isDir })),
      mode
    })
    setMenu(null)
    const label = entries.length === 1 ? entries[0].name : `${entries.length} 项`
    toast(mode === 'move' ? `已剪切 ${label}，去目标目录粘贴` : `已复制 ${label}，去目标目录粘贴`)
  }

  async function paste(destDir: string) {
    if (!tab || !clip || clip.items.length === 0) {
      toast('还没有复制或剪切的文件', 'err')
      return
    }
    if (clip.tabId !== tab.id) {
      toast('这是另一台机器上的文件，粘不上', 'err')
      return
    }
    setMenu(null)
    const action = clip.mode === 'move' ? 'move' : 'copy'
    const label = clip.items.length === 1 ? clip.items[0].name : `${clip.items.length} 项`
    toast(clip.mode === 'move' ? `正在移动 ${label}` : `正在复制 ${label}`)
    let lastName = clip.items[0].name
    for (const item of clip.items) {
      const result =
        clip.mode === 'move'
          ? await window.duty.sftp.move(tab.id, item.path, destDir, item.isDir)
          : await window.duty.sftp.copy(tab.id, item.path, destDir, item.isDir)
      if (!result.ok) {
        toast(explainFsError(action, destDir, result.error), 'err')
        void load(cwd)
        return
      }
      lastName = result.data?.name || item.name
    }
    if (clip.mode === 'move') setClip(null)
    const done =
      clip.items.length === 1
        ? lastName
        : `${clip.items.length} 项`
    toast(clip.mode === 'move' ? `已把 ${done} 移到 ${destDir}` : `已复制 ${done} 到 ${destDir}`)
    void load(cwd)
  }

  function openMenu(event: MouseEvent, entry: FileEntry | null) {
    event.preventDefault()
    event.stopPropagation()
    let targets: FileEntry[] = []
    if (entry) {
      if (selected.includes(entry.path)) {
        targets = files.filter((file) => selected.includes(file.path))
      } else {
        setSelected([entry.path])
        setAnchor(entry.path)
        targets = [entry]
      }
    }
    const width = 176
    const height = entry ? (targets.length > 1 ? 220 : entry.isDir ? 300 : 260) : 180
    setMenu({
      x: Math.min(Math.max(8, event.clientX), window.innerWidth - width - 8),
      y: Math.min(Math.max(8, event.clientY), window.innerHeight - height - 8),
      entry,
      targets
    })
  }

  function onRowClick(event: MouseEvent, entry: FileEntry) {
    paneRef.current?.focus()
    const toggle = event.ctrlKey || event.metaKey
    const range = event.shiftKey
    if (range && anchor) {
      const from = visible.findIndex((file) => file.path === anchor)
      const to = visible.findIndex((file) => file.path === entry.path)
      if (from >= 0 && to >= 0) {
        const start = Math.min(from, to)
        const end = Math.max(from, to)
        const ranged = visible.slice(start, end + 1).map((file) => file.path)
        setSelected(toggle ? [...new Set([...selected, ...ranged])] : ranged)
        return
      }
    }
    if (toggle) {
      setSelected((prev) =>
        prev.includes(entry.path) ? prev.filter((path) => path !== entry.path) : [...prev, entry.path]
      )
      if (!anchor) setAnchor(entry.path)
      return
    }
    setSelected([entry.path])
    setAnchor(entry.path)
  }

  function cancelDownload() {
    void window.duty.sftp.cancelDownload()
  }

  const liveClip = clip && tab && clip.tabId === tab.id ? clip : null
  const clipLabel =
    liveClip && liveClip.items.length === 1
      ? liveClip.items[0].name
      : liveClip
        ? `${liveClip.items.length} 项`
        : ''
  const cutPaths = new Set(
    liveClip?.mode === 'move' ? liveClip.items.map((item) => item.path) : []
  )

  if (!tab || !ready) {
    return <div className="empty">先连上一台。连上了才有文件可以翻，不然只是在假装值班。</div>
  }

  return (
    <div
      ref={paneRef}
      tabIndex={-1}
      className={`files-pane ${dragging ? 'is-drop' : ''}`}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
        const key = event.key.toLowerCase()
        if (!(event.ctrlKey || event.metaKey)) return
        if (key === 'c' && selectedEntries.length) {
          event.preventDefault()
          mark(selectedEntries, 'copy')
        }
        if (key === 'x' && selectedEntries.length) {
          event.preventDefault()
          mark(selectedEntries, 'move')
        }
        if (key === 'v' && liveClip) {
          event.preventDefault()
          void paste(cwd)
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        void dropFiles(event.dataTransfer.files)
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <nav
        ref={crumbRef}
        className="files-crumb"
        title={cwd}
        onWheel={(event) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          event.currentTarget.scrollLeft += event.deltaY
          event.preventDefault()
        }}
      >
        {crumbs(cwd).map((item, index) => (
          <span key={item.path} className="files-crumb-item">
            {index > 0 ? <span className="files-sep">/</span> : null}
            <button onClick={() => void load(item.path)}>{item.name}</button>
          </span>
        ))}
      </nav>

      <div className="files-toolbar">
        <button className="files-tool icon-only" disabled={cwd === '/'} onClick={() => void load(parent)} title="返回上层">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button className="files-tool" onClick={() => void load(cwd)} title="刷新">
          刷新
        </button>
        <button className="files-tool" onClick={() => void upload()} title="上传到当前目录">
          上传
        </button>
        <button className="files-tool" onClick={() => setCreating(true)} title="新建文件夹">
          新目录
        </button>
        {selectedEntries.length > 0 ? (
          <button
            className="files-tool"
            disabled={downloading}
            onClick={() => void downloadEntries(selectedEntries)}
            title={selectedEntries.some((entry) => entry.isDir) ? '下载所选（含文件夹）' : '下载所选'}
          >
            {downloadLabel}
          </button>
        ) : null}
      </div>

      <label className="search files-search">
        <span>⌕</span>
        <input
          value={filter}
          placeholder="过滤当前目录"
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>

      <div className="files-meta">
        <span>
          {visible.filter((file) => file.isDir).length} 个目录 · {visible.filter((file) => !file.isDir).length} 个文件
          {selectedEntries.length > 0 ? ` · 已选 ${selectedEntries.length} 项` : ''}
        </span>
        {hiddenCount > 0 ? (
          <button className="files-hidden" onClick={() => setShowHidden((value) => !value)}>
            {showHidden ? '收起隐藏文件' : `显示 ${hiddenCount} 个隐藏`}
          </button>
        ) : null}
      </div>

      {liveClip ? (
        <div className="files-clip">
          <span>
            {liveClip.mode === 'move' ? '移动' : '复制'} {clipLabel}
          </span>
          <button className="files-action" onClick={() => void paste(cwd)}>
            粘贴到这里
          </button>
          <button className="files-action" onClick={() => setClip(null)}>
            取消
          </button>
        </div>
      ) : null}

      {creating ? (
        <form
          className="files-create"
          onSubmit={(event) => {
            event.preventDefault()
            void mkdir()
          }}
        >
          <input
            autoFocus
            value={newName}
            placeholder="文件夹名字"
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setCreating(false)
                setNewName('')
              }
            }}
          />
          <button type="submit" className="happy-btn">
            建
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setCreating(false)
              setNewName('')
            }}
          >
            取消
          </button>
        </form>
      ) : null}

      <div
        className="scroll files-list"
        onContextMenu={(event) => openMenu(event, null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setSelected([])
            setAnchor(null)
          }
        }}
      >
        {loading && files.length === 0 ? <div className="empty">翻目录中…</div> : null}
        {cwd !== '/' ? (
          <button className="files-row parent" onClick={() => void load(parent)}>
            <span className="files-icon up">↑</span>
            <span className="file-name">返回上层</span>
          </button>
        ) : null}
        {visible.map((file) => (
          <div
            key={file.path}
            className={`files-row ${selected.includes(file.path) ? 'selected' : ''} ${file.isDir ? 'dir' : 'file'} ${cutPaths.has(file.path) ? 'cut' : ''}`}
            onMouseDown={(event) => {
              if (event.shiftKey || event.ctrlKey || event.metaKey) event.preventDefault()
            }}
            onClick={(event) => onRowClick(event, file)}
            onDoubleClick={() => void openEntry(file)}
            onContextMenu={(event) => openMenu(event, file)}
          >
            <span className={`files-icon ${file.isDir ? 'dir' : extClass(file.name)}`}>
              {file.isDir ? <FolderIcon /> : <FileIcon kind={extClass(file.name)} />}
            </span>
            <span className="files-copy">
              <span className="file-name">{file.name}</span>
              <span className="file-meta">
                {file.isDir ? '文件夹' : formatSize(file.size)}
                {file.mtime ? ` · ${formatTime(file.mtime)}` : ''}
              </span>
            </span>
          </div>
        ))}
        {!loading && visible.length === 0 ? (
          <div className="empty">
            {filter ? '这个名字对不上。' : showHidden ? '空目录，可以往里丢文件。' : '看起来空空的，点上面显示隐藏文件试试。'}
          </div>
        ) : null}
      </div>

      {selectedEntries.length > 0 || downloading ? (
        <div className="files-dock">
          <div className="files-dock-name" title={selectedEntry?.name}>
            {downloading
              ? '正在下载…'
              : selectedEntry
                ? selectedEntry.name
                : `已选 ${selectedEntries.length} 项`}
          </div>
          {selectedEntry?.isDir && !downloading ? (
            <button className="files-action" onClick={() => void openEntry(selectedEntry)}>
              打开
            </button>
          ) : null}
          {downloading ? (
            <button className="files-action" onClick={cancelDownload}>
              取消
            </button>
          ) : (
            <button className="files-action" onClick={() => void downloadEntries(selectedEntries)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v12" />
                <path d="m7 11 5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              {downloadLabel}
            </button>
          )}
          <button className="files-action" disabled={downloading} onClick={() => mark(selectedEntries, 'copy')}>
            复制
          </button>
          <button className="files-action" disabled={downloading} onClick={() => mark(selectedEntries, 'move')}>
            移动
          </button>
          <button
            className="files-action danger"
            disabled={downloading}
            onClick={() => void remove(selectedEntries)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16" />
              <path d="M9 7V5h6v2" />
              <path d="M6 7l1 14h10l1-14" />
            </svg>
            删除
          </button>
        </div>
      ) : (
        <div className="files-hint">双击进文件夹。Ctrl 多选，Shift 连选。右键复制或移动，到目标目录粘贴。</div>
      )}

      {dragging ? <div className="files-drop">松手就传到这里</div> : null}
      {menu ? (
        <FileMenu
          x={menu.x}
          y={menu.y}
          entry={menu.entry}
          targets={menu.targets}
          canPaste={Boolean(liveClip)}
          downloading={downloading}
          onOpen={(entry) => {
            setMenu(null)
            void openEntry(entry)
          }}
          onDownload={(entries) => void downloadEntries(entries)}
          onCopy={(entries) => mark(entries, 'copy')}
          onMove={(entries) => mark(entries, 'move')}
          onPaste={(dest) => void paste(dest || cwd)}
          onDelete={(entries) => {
            setMenu(null)
            void remove(entries)
          }}
          onRefresh={() => {
            setMenu(null)
            void load(cwd)
          }}
          onMkdir={() => {
            setMenu(null)
            setCreating(true)
          }}
          onUpload={(dest) => void upload(dest || cwd)}
        />
      ) : null}
    </div>
  )
}

function FileMenu({
  x,
  y,
  entry,
  targets,
  canPaste,
  downloading,
  onOpen,
  onDownload,
  onCopy,
  onMove,
  onPaste,
  onDelete,
  onRefresh,
  onMkdir,
  onUpload
}: {
  x: number
  y: number
  entry: FileEntry | null
  targets: FileEntry[]
  canPaste: boolean
  downloading: boolean
  onOpen: (entry: FileEntry) => void
  onDownload: (entries: FileEntry[]) => void
  onCopy: (entries: FileEntry[]) => void
  onMove: (entries: FileEntry[]) => void
  onPaste: (dest?: string) => void
  onDelete: (entries: FileEntry[]) => void
  onRefresh: () => void
  onMkdir: () => void
  onUpload: (dest?: string) => void
}) {
  const multi = targets.length > 1
  const onlyDir = targets.length === 1 && targets[0].isDir
  return (
    <div
      className="files-ctx"
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {entry ? (
        <>
          {onlyDir ? <button onClick={() => void onOpen(entry)}>打开</button> : null}
          <button disabled={downloading} onClick={() => onDownload(targets)}>
            {multi ? `下载 ${targets.length} 项` : onlyDir || entry.isDir ? '下载文件夹' : '下载'}
          </button>
          {!multi && entry.isDir ? (
            <button onClick={() => onUpload(entry.path)}>上传到此处</button>
          ) : !multi ? (
            <button onClick={() => onUpload()}>上传</button>
          ) : null}
          <button onClick={() => onCopy(targets)}>复制</button>
          <button onClick={() => onMove(targets)}>移动</button>
          {onlyDir ? (
            <button disabled={!canPaste} onClick={() => onPaste(entry.path)}>
              粘贴到此处
            </button>
          ) : (
            <button disabled={!canPaste} onClick={() => onPaste()}>
              粘贴
            </button>
          )}
          <div className="files-ctx-line" />
          <button className="danger" onClick={() => void onDelete(targets)}>
            删除
          </button>
        </>
      ) : (
        <>
          <button onClick={() => onUpload()}>上传</button>
          <button disabled={!canPaste} onClick={() => onPaste()}>
            粘贴
          </button>
          <button onClick={onRefresh}>刷新</button>
          <button onClick={onMkdir}>新目录</button>
        </>
      )}
    </div>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 6.75A1.75 1.75 0 0 1 4.75 5h4.09c.3 0 .59.12.8.33L11.5 7h7.75A1.75 1.75 0 0 1 21 8.75v8.5A1.75 1.75 0 0 1 19.25 19H4.75A1.75 1.75 0 0 1 3 17.25V6.75Z"
      />
    </svg>
  )
}

function FileIcon({ kind }: { kind: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        opacity={kind === 'file' ? 0.85 : 1}
        d="M7 3.5h7.2L19 8.4V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5H7Zm7.3.7v3.6c0 .5.4.9.9.9H19"
      />
    </svg>
  )
}

function uploadDone(cwd: string, count?: number): string {
  if (count && count > 1) return `已上传 ${count} 个文件到 ${cwd}`
  return `已上传到 ${cwd}`
}

function crumbs(path: string): { name: string; path: string }[] {
  if (path === '/') return [{ name: '根目录', path: '/' }]
  const parts = path.split('/').filter(Boolean)
  const items = [{ name: '根目录', path: '/' }]
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    items.push({ name: part, path: acc })
  }
  return items
}

function extClass(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'img'
  if (['zip', 'gz', 'tar', 'tgz', 'rar', '7z'].includes(ext)) return 'zip'
  if (['log', 'txt', 'md', 'json', 'yml', 'yaml', 'conf', 'ini'].includes(ext)) return 'text'
  if (['sh', 'py', 'js', 'ts', 'go'].includes(ext)) return 'code'
  return 'file'
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(mtime: number): string {
  if (!mtime) return ''
  const date = new Date(mtime)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}
