import { app, ipcMain, type BrowserWindow } from 'electron'
import { autoUpdater, NsisUpdater } from 'electron-updater'
import type { AppUpdateStatus } from '../shared/types'

let getWindow: () => BrowserWindow | null = () => null
let quiet = true
let checking = false
let startupScheduled = false
let status: AppUpdateStatus = { phase: 'idle', quiet: true, currentVersion: '' }

function currentVersion(): string {
  return app.getVersion()
}

function emit(next: AppUpdateStatus): void {
  status = next
  const win = getWindow()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('update:status', next)
}

function unsupported(message: string): AppUpdateStatus {
  return { phase: 'unsupported', quiet, currentVersion: currentVersion(), message }
}

function canUpdate(): AppUpdateStatus | null {
  if (!app.isPackaged) return unsupported('开发模式先不折腾更新')
  if (process.platform !== 'win32') return unsupported('目前只给 Windows 安装包做自动更新')
  if (process.env.PORTABLE_EXECUTABLE_DIR) return unsupported('便携版不能自动更新，去下安装包')
  return null
}

function wireUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  if ('verifyUpdateCodeSignature' in autoUpdater) {
    ;(autoUpdater as NsisUpdater).verifyUpdateCodeSignature = async () => null
  }

  autoUpdater.on('checking-for-update', () => {
    emit({ phase: 'checking', quiet, currentVersion: currentVersion() })
  })
  autoUpdater.on('update-available', (info) => {
    checking = false
    emit({
      phase: 'available',
      quiet,
      currentVersion: currentVersion(),
      version: info.version
    })
  })
  autoUpdater.on('update-not-available', () => {
    checking = false
    emit({ phase: 'unavailable', quiet, currentVersion: currentVersion() })
  })
  autoUpdater.on('download-progress', (progress) => {
    emit({
      phase: 'downloading',
      quiet,
      currentVersion: currentVersion(),
      percent: Math.max(0, Math.min(100, Math.round(progress.percent)))
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    emit({
      phase: 'ready',
      quiet: false,
      currentVersion: currentVersion(),
      version: info.version
    })
  })
  autoUpdater.on('error', (error) => {
    checking = false
    emit({
      phase: 'error',
      quiet,
      currentVersion: currentVersion(),
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

async function check(nextQuiet: boolean): Promise<AppUpdateStatus> {
  quiet = nextQuiet
  const blocked = canUpdate()
  if (blocked) {
    emit(blocked)
    return blocked
  }
  if (checking || status.phase === 'downloading') return status
  checking = true
  try {
    await autoUpdater.checkForUpdates()
    checking = false
  } catch (error) {
    checking = false
    const next: AppUpdateStatus = {
      phase: 'error',
      quiet,
      currentVersion: currentVersion(),
      message: error instanceof Error ? error.message : String(error)
    }
    emit(next)
    return next
  }
  return status
}

export function setupAutoUpdate(getMainWindow: () => BrowserWindow | null): void {
  getWindow = getMainWindow
  status = { phase: 'idle', quiet: true, currentVersion: currentVersion() }
  wireUpdater()

  ipcMain.handle('app:version', () => currentVersion())
  ipcMain.handle('update:get', () => status)
  ipcMain.handle('update:check', (_event, nextQuiet?: boolean) => check(Boolean(nextQuiet)))
  ipcMain.handle('update:download', async () => {
    const blocked = canUpdate()
    if (blocked) {
      emit(blocked)
      return blocked
    }
    quiet = false
    emit({ phase: 'downloading', quiet: false, currentVersion: currentVersion(), percent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      emit({
        phase: 'error',
        quiet: false,
        currentVersion: currentVersion(),
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return status
  })
  ipcMain.handle('update:install', () => {
    const blocked = canUpdate()
    if (blocked) {
      emit(blocked)
      return blocked
    }
    autoUpdater.quitAndInstall(false, true)
    return status
  })
}

export function scheduleStartupUpdateCheck(): void {
  if (startupScheduled) return
  startupScheduled = true
  setTimeout(() => {
    void check(true)
  }, 1500)
}
