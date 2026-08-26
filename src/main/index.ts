import { join } from 'path'
import { app, BrowserWindow, Menu, nativeImage, shell, type Input, type WebContents } from 'electron'
import { applyWindowChrome } from './chrome'
import { registerIpc } from './ipc'
import { SshManager } from './ssh'
import { getAppearance } from './store'
import { scheduleStartupUpdateCheck, setupAutoUpdate } from './update'

app.setName('值班快乐机')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.roy.duty-happy')
}

/** Only `electron-vite dev` sets ELECTRON_RENDERER_URL. Packaged / preview / pack:win do not. */
const allowDevTools = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)

function isDevToolsShortcut(input: Input): boolean {
  if (input.type !== 'keyDown') return false
  if (input.key === 'F12') return true
  const ctrlOrCmd = input.control || input.meta
  const key = input.key.toLowerCase()
  return ctrlOrCmd && input.shift && (key === 'i' || key === 'j' || key === 'c')
}

function lockWebContents(contents: WebContents): void {
  contents.on('before-input-event', (event, input) => {
    if (!isDevToolsShortcut(input)) return
    event.preventDefault()
    if (allowDevTools) contents.toggleDevTools()
  })
  if (!allowDevTools) {
    contents.on('devtools-opened', () => contents.closeDevTools())
  }
}

app.on('web-contents-created', (_event, contents) => {
  lockWebContents(contents)
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

function appIcon() {
  const file = join(
    app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources'),
    process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  )
  const image = nativeImage.createFromPath(file)
  return image.isEmpty() ? undefined : image
}

let mainWindow: BrowserWindow | null = null
const ssh = new SshManager(() => mainWindow)

function createWindow(): void {
  const appearance = getAppearance()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: appIcon(),
    backgroundColor: appearance === 'night' ? '#071321' : '#f4f6fb',
    title: '值班快乐机',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: appearance === 'night' ? '#071321' : '#f4f6fb',
      symbolColor: appearance === 'night' ? '#eaf3ff' : '#1b2430',
      height: 48
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: allowDevTools
    }
  })
  applyWindowChrome(mainWindow, appearance)
  void mainWindow.webContents.setVisualZoomLevelLimits(1, 1)

  mainWindow.on('close', () => {
    ssh.disconnectAll()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    scheduleStartupUpdateCheck()
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (!allowDevTools) Menu.setApplicationMenu(null)
  registerIpc(ssh, () => mainWindow)
  setupAutoUpdate(() => mainWindow)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ssh.disconnectAll()
  if (process.platform !== 'darwin') app.quit()
})
