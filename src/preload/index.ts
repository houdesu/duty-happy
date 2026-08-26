import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AiChatMessage,
  AiContext,
  AiDeltaKind,
  AiExecResult,
  AiMode,
  AiSettingsInput,
  AiThread,
  AiToolCall,
  AppUpdateStatus,
  InvokeResult,
  SessionInput,
  Snippet,
  SshConnectPayload
} from '../shared/types'

const api = {
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    upsert: (input: SessionInput) => ipcRenderer.invoke('sessions:upsert', input),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    pickKey: () => ipcRenderer.invoke('sessions:pick-key')
  },
  ssh: {
    connect: (payload: SshConnectPayload) => ipcRenderer.invoke('ssh:connect', payload),
    write: (tabId: string, data: string) => ipcRenderer.send('ssh:write', { tabId, data }),
    resize: (tabId: string, cols: number, rows: number) =>
      ipcRenderer.send('ssh:resize', { tabId, cols, rows }),
    disconnect: (tabId: string) => ipcRenderer.invoke('ssh:disconnect', tabId),
    exec: (tabId: string, command: string, timeoutMs?: number) =>
      ipcRenderer.invoke('ssh:exec', { tabId, command, timeoutMs }) as Promise<InvokeResult<AiExecResult>>,
    onData: (callback: (payload: { tabId: string; data: Uint8Array }) => void) =>
      on('ssh:data', callback),
    onStatus: (callback: (payload: { tabId: string; status: string }) => void) =>
      on('ssh:status', callback)
  },
  sftp: {
    list: (tabId: string, path: string) => ipcRenderer.invoke('sftp:list', { tabId, path }),
    mkdir: (tabId: string, path: string) => ipcRenderer.invoke('sftp:mkdir', { tabId, path }),
    remove: (tabId: string, path: string, isDir: boolean) =>
      ipcRenderer.invoke('sftp:remove', { tabId, path, isDir }),
    download: (tabId: string, items: { path: string; isDir: boolean }[]) =>
      ipcRenderer.invoke('sftp:download', { tabId, items }),
    cancelDownload: () => ipcRenderer.invoke('sftp:download-cancel'),
    upload: (tabId: string, remoteDir: string) =>
      ipcRenderer.invoke('sftp:upload', { tabId, remoteDir }),
    uploadPaths: (tabId: string, remoteDir: string, localPaths: string[]) =>
      ipcRenderer.invoke('sftp:upload-paths', { tabId, remoteDir, localPaths }),
    copy: (tabId: string, src: string, destDir: string, isDir: boolean) =>
      ipcRenderer.invoke('sftp:copy', { tabId, src, destDir, isDir }),
    move: (tabId: string, src: string, destDir: string, isDir: boolean) =>
      ipcRenderer.invoke('sftp:move', { tabId, src, destDir, isDir }),
    onReady: (callback: (payload: { tabId: string; path: string }) => void) =>
      on('sftp:ready', callback)
  },
  files: {
    pathOf: (file: File) => webUtils.getPathForFile(file)
  },
  snippets: {
    list: () => ipcRenderer.invoke('snippets:list'),
    upsert: (snippet: Snippet) => ipcRenderer.invoke('snippets:upsert', snippet),
    delete: (id: string) => ipcRenderer.invoke('snippets:delete', id)
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    add: (command: string) => ipcRenderer.invoke('history:add', command),
    clear: () => ipcRenderer.invoke('history:clear')
  },
  theme: {
    get: () => ipcRenderer.invoke('theme:get') as Promise<'light' | 'night'>,
    set: (appearance: 'light' | 'night') =>
      ipcRenderer.invoke('theme:set', appearance) as Promise<'light' | 'night'>
  },
  ai: {
    get: () => ipcRenderer.invoke('ai:get'),
    save: (input: AiSettingsInput) => ipcRenderer.invoke('ai:save', input),
    ask: (payload: { id: number; messages: AiChatMessage[]; context?: AiContext; agent?: boolean; mode?: AiMode }) =>
      ipcRenderer.send('ai:ask', payload),
    abort: () => ipcRenderer.send('ai:abort'),
    onDelta: (callback: (payload: { id: number; text: string; kind?: AiDeltaKind }) => void) =>
      on('ai:delta', callback),
    onDone: (callback: (payload: { id: number; aborted?: boolean; toolCalls?: AiToolCall[] }) => void) =>
      on('ai:done', callback),
    onError: (callback: (payload: { id: number; error: string }) => void) => on('ai:error', callback),
    threads: {
      list: () => ipcRenderer.invoke('ai:threads:list') as Promise<AiThread[]>,
      upsert: (thread: AiThread) => ipcRenderer.invoke('ai:threads:upsert', thread) as Promise<AiThread[]>,
      delete: (id: string) => ipcRenderer.invoke('ai:threads:delete', id) as Promise<AiThread[]>
    }
  },
  app: {
    version: () => ipcRenderer.invoke('app:version') as Promise<string>
  },
  update: {
    get: () => ipcRenderer.invoke('update:get') as Promise<AppUpdateStatus>,
    check: (quiet?: boolean) => ipcRenderer.invoke('update:check', quiet) as Promise<AppUpdateStatus>,
    download: () => ipcRenderer.invoke('update:download') as Promise<AppUpdateStatus>,
    install: () => ipcRenderer.invoke('update:install') as Promise<AppUpdateStatus>,
    onStatus: (callback: (payload: AppUpdateStatus) => void) => on('update:status', callback)
  }
}

function on<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export type DutyApi = typeof api

contextBridge.exposeInMainWorld('duty', api)
