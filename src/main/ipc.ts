import { basename, join } from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { Appearance, AiChatMessage, AiContext, AiDeltaKind, AiMode, AiThread, SessionInput, Snippet, SshConnectPayload } from '../shared/types'
import { applyWindowChrome } from './chrome'
import { SshManager } from './ssh'
import { streamChat } from './ai'
import {
  addHistory,
  clearHistory,
  deleteSession,
  deleteSnippet,
  getAppearance,
  getAiPublic,
  listAiThreads,
  listHistory,
  listSessions,
  listSnippets,
  saveAiSettings,
  upsertAiThread,
  deleteAiThread,
  setAppearance,
  upsertSession,
  upsertSnippet
} from './store'

export function registerIpc(ssh: SshManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('sessions:list', () => listSessions())
  ipcMain.handle('sessions:upsert', (_event, input: SessionInput) => upsertSession(input))
  ipcMain.handle('sessions:delete', (_event, id: string) => {
    deleteSession(id)
    return { ok: true }
  })
  ipcMain.handle('sessions:pick-key', async () => {
    const win = getWindow()
    if (!win) return { ok: false }
    const result = await dialog.showOpenDialog(win, {
      title: '选择私钥',
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false }
    return { ok: true, data: result.filePaths[0] }
  })

  ipcMain.handle('ssh:connect', async (_event, payload: SshConnectPayload) => {
    try {
      await ssh.connect(payload.tabId, payload.sessionId, payload.cols, payload.rows)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.on('ssh:write', (_event, payload: { tabId: string; data: string }) => {
    ssh.write(payload.tabId, payload.data)
  })
  ipcMain.on('ssh:resize', (_event, payload: { tabId: string; cols: number; rows: number }) => {
    ssh.resize(payload.tabId, payload.cols, payload.rows)
  })
  ipcMain.handle('ssh:disconnect', (_event, tabId: string) => {
    ssh.disconnect(tabId)
    return { ok: true }
  })
  ipcMain.handle('ssh:exec', async (_event, payload: { tabId: string; command: string; timeoutMs?: number }) => {
    try {
      return { ok: true, data: await ssh.exec(payload.tabId, payload.command, payload.timeoutMs) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('sftp:list', async (_event, payload: { tabId: string; path: string }) => {
    try {
      return { ok: true, data: await ssh.list(payload.tabId, payload.path) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('sftp:mkdir', async (_event, payload: { tabId: string; path: string }) => {
    try {
      await ssh.mkdir(payload.tabId, payload.path)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('sftp:remove', async (_event, payload: { tabId: string; path: string; isDir: boolean }) => {
    try {
      await ssh.remove(payload.tabId, payload.path, payload.isDir)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(
    'sftp:download',
    async (_event, payload: { tabId: string; items: { path: string; isDir: boolean }[] }) => {
      const win = getWindow()
      if (!win) return { ok: false, error: '窗口不存在' }
      const items = payload.items?.filter((item) => item?.path) || []
      if (items.length === 0) return { ok: false, error: '没有要下载的文件' }

      let jobs: { remotePath: string; localPath: string; isDir: boolean }[] = []
      if (items.length === 1 && !items[0].isDir) {
        const result = await dialog.showSaveDialog(win, {
          title: '保存文件',
          defaultPath: basename(items[0].path)
        })
        if (result.canceled || !result.filePath) return { canceled: true }
        jobs = [{ remotePath: items[0].path, localPath: result.filePath, isDir: false }]
      } else if (items.length === 1 && items[0].isDir) {
        const result = await dialog.showSaveDialog(win, {
          title: '下载文件夹',
          defaultPath: basename(items[0].path),
          buttonLabel: '下载'
        })
        if (result.canceled || !result.filePath) return { canceled: true }
        jobs = [{ remotePath: items[0].path, localPath: result.filePath, isDir: true }]
      } else {
        const result = await dialog.showOpenDialog(win, {
          title: '选择保存目录',
          properties: ['openDirectory', 'createDirectory']
        })
        if (result.canceled || !result.filePaths[0]) return { canceled: true }
        const dest = result.filePaths[0]
        jobs = items.map((item) => ({
          remotePath: item.path,
          localPath: join(dest, basename(item.path)),
          isDir: item.isDir
        }))
      }

      const signal = ssh.startDownload()
      try {
        for (const job of jobs) {
          if (signal.aborted) throw new Error('已取消下载')
          await ssh.downloadTree(payload.tabId, job.remotePath, job.localPath, job.isDir, signal)
        }
        return { ok: true, count: jobs.length }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === '已取消下载' || signal.aborted) return { canceled: true, error: '已取消下载' }
        return { ok: false, error: message }
      }
    }
  )
  ipcMain.handle('sftp:download-cancel', () => {
    ssh.cancelDownload()
    return { ok: true }
  })
  ipcMain.handle('sftp:upload', async (_event, payload: { tabId: string; remoteDir: string }) => {
    const win = getWindow()
    if (!win) return { ok: false, error: '窗口不存在' }
    const result = await dialog.showOpenDialog(win, {
      title: '上传文件',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    try {
      for (const localPath of result.filePaths) {
        await ssh.upload(payload.tabId, localPath, joinPosix(payload.remoteDir, basename(localPath)))
      }
      return { ok: true, count: result.filePaths.length }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('sftp:upload-paths', async (_event, payload: { tabId: string; remoteDir: string; localPaths: string[] }) => {
    try {
      for (const localPath of payload.localPaths) {
        await ssh.upload(payload.tabId, localPath, joinPosix(payload.remoteDir, basename(localPath)))
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(
    'sftp:copy',
    async (_event, payload: { tabId: string; src: string; destDir: string; isDir: boolean }) => {
      try {
        return { ok: true, data: await ssh.copy(payload.tabId, payload.src, payload.destDir, payload.isDir) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
  ipcMain.handle(
    'sftp:move',
    async (_event, payload: { tabId: string; src: string; destDir: string; isDir: boolean }) => {
      try {
        return { ok: true, data: await ssh.move(payload.tabId, payload.src, payload.destDir, payload.isDir) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle('snippets:list', () => listSnippets())
  ipcMain.handle('snippets:upsert', (_event, snippet: Snippet) => upsertSnippet(snippet))
  ipcMain.handle('snippets:delete', (_event, id: string) => {
    deleteSnippet(id)
    return { ok: true }
  })
  ipcMain.handle('history:list', () => listHistory())
  ipcMain.handle('history:add', (_event, command: string) => addHistory(command))
  ipcMain.handle('history:clear', () => {
    clearHistory()
    return { ok: true }
  })
  ipcMain.handle('theme:get', () => getAppearance())
  ipcMain.handle('theme:set', (_event, appearance: Appearance) => {
    const next = setAppearance(appearance)
    const win = getWindow()
    if (win) applyWindowChrome(win, next)
    return next
  })

  ipcMain.handle('ai:get', () => getAiPublic())
  ipcMain.handle('ai:save', (_event, input) => saveAiSettings(input))
  ipcMain.handle('ai:threads:list', () => listAiThreads())
  ipcMain.handle('ai:threads:upsert', (_event, thread: AiThread) => upsertAiThread(thread))
  ipcMain.handle('ai:threads:delete', (_event, id: string) => deleteAiThread(id))

  let abortChat: AbortController | null = null
  let activeChat = 0
  ipcMain.on(
    'ai:ask',
    async (event, payload: { id?: number; messages: AiChatMessage[]; context?: AiContext; agent?: boolean; mode?: AiMode }) => {
      abortChat?.abort()
      abortChat = new AbortController()
      const signal = abortChat.signal
      const id = payload.id || Date.now()
      activeChat = id
      const mode: AiMode = payload.mode || (payload.agent ? 'agent' : 'ask')
      try {
        const { toolCalls } = await streamChat(
          payload.messages,
          payload.context,
          signal,
          (text, kind: AiDeltaKind = 'content') => {
            if (!signal.aborted && activeChat === id) event.sender.send('ai:delta', { id, text, kind })
          },
          mode
        )
        if (activeChat === id) event.sender.send('ai:done', { id, aborted: signal.aborted, toolCalls })
      } catch (error) {
        if (activeChat !== id) return
        if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          event.sender.send('ai:done', { id, aborted: true, toolCalls: [] })
          return
        }
        event.sender.send('ai:error', {
          id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  )
  ipcMain.on('ai:abort', () => {
    abortChat?.abort()
    abortChat = null
  })
}

function joinPosix(dir: string, name: string): string {
  if (dir === '/') return `/${name}`
  return `${dir.replace(/\/+$/, '')}/${name}`
}
