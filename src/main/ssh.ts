import { mkdirSync, readFileSync } from 'fs'
import { join as joinLocal } from 'path'
import { pipeline } from 'stream/promises'
import { Client, type ClientChannel, type SFTPWrapper, type Stats } from 'ssh2'
import type { BrowserWindow } from 'electron'
import type { AiExecResult, FileEntry } from '../shared/types'
import { getKnownHost, getSessionSecret, setKnownHost, touchSession } from './store'

interface Connection {
  tabId: string
  client: Client
  stream?: ClientChannel
  sftp?: SFTPWrapper
}

export class SshManager {
  private connections = new Map<string, Connection>()
  private downloadAbort: AbortController | null = null

  constructor(private getWindow: () => BrowserWindow | null) {}

  async connect(tabId: string, sessionId: string, cols: number, rows: number): Promise<void> {
    this.disconnect(tabId)

    const session = getSessionSecret(sessionId)
    if (!session) throw new Error('会话不存在')

    const client = new Client()
    const conn: Connection = { tabId, client }
    this.connections.set(tabId, conn)

    const hostKeyId = `${session.host}:${session.port}`

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        this.disconnect(tabId)
        reject(error)
      }
      const ok = () => {
        if (settled) return
        settled = true
        resolve()
      }

      client
        .on('ready', () => {
          touchSession(sessionId)
          client.shell(
            { term: 'xterm-256color', cols, rows },
            { env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color' } },
            (error, stream) => {
              if (error) return fail(error)
              conn.stream = stream
              stream.on('data', (chunk: Buffer) => this.send('ssh:data', { tabId, data: chunk }))
              stream.stderr?.on('data', (chunk: Buffer) =>
                this.send('ssh:data', { tabId, data: chunk })
              )
              stream.on('close', () => this.send('ssh:status', { tabId, status: 'closed' }))
              this.send('ssh:status', { tabId, status: 'connected' })
              ok()

              client.sftp((sftpError, sftp) => {
                if (sftpError || !sftp) return
                conn.sftp = sftp
                sftp.realpath('.', (pathError, home) => {
                  this.send('sftp:ready', { tabId, path: pathError ? '/' : home || '/' })
                })
              })
            }
          )
        })
        .on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))
        .on('close', () => {
          if (this.connections.get(tabId)?.client === client) {
            this.send('ssh:status', { tabId, status: 'closed' })
          }
        })

      try {
        client.connect({
          host: session.host,
          port: session.port,
          username: session.username,
          password: session.auth === 'password' ? session.password : undefined,
          privateKey:
            session.auth === 'key' && session.privateKeyPath
              ? readFileSync(session.privateKeyPath)
              : undefined,
          passphrase: session.auth === 'key' ? session.passphrase : undefined,
          readyTimeout: 20000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 4,
          hostHash: 'sha256',
          hostVerifier: (hashedKey: string) => {
            const known = getKnownHost(hostKeyId)
            if (!known) {
              setKnownHost(hostKeyId, hashedKey)
              return true
            }
            if (known !== hashedKey) {
              fail(new Error(`主机密钥已变化：${session.host}`))
              return false
            }
            return true
          }
        })
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  write(tabId: string, data: string): void {
    this.connections.get(tabId)?.stream?.write(data)
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.connections.get(tabId)?.stream?.setWindow(rows, cols, 0, 0)
  }

  async exec(tabId: string, command: string, timeoutMs = 45000): Promise<AiExecResult> {
    const conn = this.connections.get(tabId)
    if (!conn) throw new Error('终端没连上')
    const timeout = Math.min(Math.max(timeoutMs, 3000), 60000)
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      let timedOut = false
      let stream: ClientChannel | undefined

      const finish = (code: number | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({
          stdout: capExec(stdout),
          stderr: capExec(stderr),
          code,
          timedOut
        })
      }

      const timer = setTimeout(() => {
        timedOut = true
        try {
          stream?.close()
        } catch {
          /* ignore */
        }
        finish(null)
      }, timeout)

      conn.client.exec(command, (error, next) => {
        if (settled) {
          try {
            next?.close()
          } catch {
            /* ignore */
          }
          return
        }
        if (error) {
          settled = true
          clearTimeout(timer)
          reject(error)
          return
        }
        stream = next
        let code: number | null = null
        next.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        next.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
        })
        next.on('exit', (exitCode: number | null) => {
          if (typeof exitCode === 'number') code = exitCode
        })
        next.on('close', () => {
          finish(code)
        })
        next.on('error', (streamError: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(streamError)
        })
      })
    })
  }

  disconnect(tabId: string): void {
    const conn = this.connections.get(tabId)
    if (!conn) return
    this.connections.delete(tabId)
    try {
      conn.stream?.stderr?.removeAllListeners()
      conn.stream?.removeAllListeners()
      conn.client.removeAllListeners()
      conn.stream?.end()
      conn.client.end()
    } catch {
      /* ignore */
    }
    this.send('ssh:status', { tabId, status: 'closed' })
  }

  async list(tabId: string, path: string): Promise<FileEntry[]> {
    const sftp = this.requireSftp(tabId)
    const list = await new Promise<FileEntry[]>((resolve, reject) => {
      sftp.readdir(path, (error, entries) => {
        if (error) return reject(error)
        resolve(
          entries
            .map((entry) => ({
              name: entry.filename,
              path: joinPosix(path, entry.filename),
              isDir: entry.attrs.isDirectory(),
              size: entry.attrs.size,
              mtime: (entry.attrs.mtime || 0) * 1000
            }))
            .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
        )
      })
    })
    return list
  }

  async mkdir(tabId: string, path: string): Promise<void> {
    const sftp = this.requireSftp(tabId)
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(path, (error) => (error ? reject(error) : resolve()))
    })
  }

  async remove(tabId: string, path: string, isDir: boolean): Promise<void> {
    const sftp = this.requireSftp(tabId)
    await new Promise<void>((resolve, reject) => {
      const done = (error: Error | null | undefined) => (error ? reject(error) : resolve())
      if (isDir) sftp.rmdir(path, done)
      else sftp.unlink(path, done)
    })
  }

  async download(tabId: string, remotePath: string, localPath: string): Promise<void> {
    const sftp = this.requireSftp(tabId)
    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (error) => (error ? reject(error) : resolve()))
    })
  }

  startDownload(): AbortSignal {
    this.downloadAbort?.abort()
    this.downloadAbort = new AbortController()
    return this.downloadAbort.signal
  }

  cancelDownload(): void {
    this.downloadAbort?.abort()
  }

  async downloadTree(
    tabId: string,
    remotePath: string,
    localPath: string,
    isDir: boolean,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) throw new Error('已取消下载')
    if (!isDir) {
      await this.download(tabId, remotePath, localPath)
      return
    }
    mkdirSync(localPath, { recursive: true })
    const entries = await this.list(tabId, remotePath)
    for (const entry of entries) {
      if (signal?.aborted) throw new Error('已取消下载')
      await this.downloadTree(tabId, entry.path, joinLocal(localPath, entry.name), entry.isDir, signal)
    }
  }

  async upload(tabId: string, localPath: string, remotePath: string): Promise<void> {
    const sftp = this.requireSftp(tabId)
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (error) => (error ? reject(error) : resolve()))
    })
  }

  async copy(
    tabId: string,
    src: string,
    destDir: string,
    isDir: boolean
  ): Promise<{ path: string; name: string }> {
    this.guardDest(src, destDir, isDir)
    const dest = await this.unusedPath(
      tabId,
      destDir,
      posixBasename(src),
      isDir,
      joinPosix(destDir, posixBasename(src)) === src
    )
    await this.copyEntry(tabId, src, dest, isDir)
    return { path: dest, name: posixBasename(dest) }
  }

  async move(
    tabId: string,
    src: string,
    destDir: string,
    isDir: boolean
  ): Promise<{ path: string; name: string }> {
    this.guardDest(src, destDir, isDir)
    const same = joinPosix(destDir, posixBasename(src))
    if (same === src) throw new Error('已经在这个目录了')
    const dest = await this.unusedPath(tabId, destDir, posixBasename(src), isDir, false)
    try {
      await this.rename(tabId, src, dest)
    } catch {
      await this.copyEntry(tabId, src, dest, isDir)
      await this.removeTree(tabId, src, isDir)
    }
    return { path: dest, name: posixBasename(dest) }
  }

  disconnectAll(): void {
    for (const tabId of Array.from(this.connections.keys())) this.disconnect(tabId)
  }

  private requireSftp(tabId: string): SFTPWrapper {
    const sftp = this.connections.get(tabId)?.sftp
    if (!sftp) throw new Error('当前标签还没有可用的文件通道')
    return sftp
  }

  private guardDest(src: string, destDir: string, isDir: boolean): void {
    if (isDir && isInside(src, destDir)) throw new Error('不能把文件夹放进它自己里面')
  }

  private async stat(tabId: string, path: string): Promise<Stats> {
    const sftp = this.requireSftp(tabId)
    return new Promise((resolve, reject) => {
      sftp.stat(path, (error, stats) => {
        if (error || !stats) reject(error || new Error('stat failed'))
        else resolve(stats)
      })
    })
  }

  private async exists(tabId: string, path: string): Promise<boolean> {
    try {
      await this.stat(tabId, path)
      return true
    } catch (error) {
      const err = error as { message?: string; code?: number | string }
      if (err.code === 2 || err.code === 'ENOENT') return false
      const msg = err.message || String(error)
      if (/no such file|enoent/i.test(msg)) return false
      throw error
    }
  }

  private async unusedPath(
    tabId: string,
    dir: string,
    name: string,
    isDir: boolean,
    forceSuffix: boolean
  ): Promise<string> {
    const first = joinPosix(dir, name)
    if (!forceSuffix && !(await this.exists(tabId, first))) return first
    for (let n = 1; n < 200; n++) {
      const candidate = joinPosix(dir, copyName(name, isDir, n))
      if (!(await this.exists(tabId, candidate))) return candidate
    }
    throw new Error('同名文件太多了')
  }

  private async copyEntry(tabId: string, src: string, dest: string, isDir: boolean): Promise<void> {
    if (isDir) {
      await this.mkdir(tabId, dest)
      const entries = await this.list(tabId, src)
      for (const entry of entries) {
        await this.copyEntry(tabId, entry.path, joinPosix(dest, entry.name), entry.isDir)
      }
      return
    }
    await this.copyFile(tabId, src, dest)
  }

  private async copyFile(tabId: string, src: string, dest: string): Promise<void> {
    const sftp = this.requireSftp(tabId)
    let mode: number | undefined
    try {
      const stats = await this.stat(tabId, src)
      mode = stats.mode & 0o777
    } catch {
      /* default mode */
    }
    await pipeline(
      sftp.createReadStream(src),
      sftp.createWriteStream(dest, mode ? { mode } : {})
    )
  }

  private async rename(tabId: string, src: string, dest: string): Promise<void> {
    const sftp = this.requireSftp(tabId)
    await new Promise<void>((resolve, reject) => {
      sftp.rename(src, dest, (error) => (error ? reject(error) : resolve()))
    })
  }

  private async removeTree(tabId: string, path: string, isDir: boolean): Promise<void> {
    if (isDir) {
      const entries = await this.list(tabId, path)
      for (const entry of entries) {
        await this.removeTree(tabId, entry.path, entry.isDir)
      }
    }
    await this.remove(tabId, path, isDir)
  }

  private send(channel: string, payload: unknown): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(channel, payload)
  }
}

const EXEC_CAP = 8000

function capExec(value: string): string {
  const text = stripExecAnsi(value)
  if (text.length <= EXEC_CAP) return text
  return `${text.slice(0, EXEC_CAP)}\n…输出太长，后面砍了`
}

function stripExecAnsi(value: string): string {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '')
    .replace(/\u001b[PX^_].*?\u001b\\/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

function joinPosix(dir: string, name: string): string {
  if (dir === '/') return `/${name}`
  return `${dir.replace(/\/+$/, '')}/${name}`
}

function posixBasename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

function normalizePosix(path: string): string {
  if (!path || path === '/') return '/'
  return path.replace(/\/+$/, '') || '/'
}

function isInside(root: string, path: string): boolean {
  const a = normalizePosix(root)
  const b = normalizePosix(path)
  if (b === a) return true
  if (a === '/') return true
  return b.startsWith(`${a}/`)
}

function copyName(name: string, isDir: boolean, n: number): string {
  let stem = name
  let ext = ''
  if (!isDir) {
    const index = name.lastIndexOf('.')
    if (index > 0) {
      stem = name.slice(0, index)
      ext = name.slice(index)
    }
  }
  return n === 1 ? `${stem} 副本${ext}` : `${stem} 副本${n}${ext}`
}
