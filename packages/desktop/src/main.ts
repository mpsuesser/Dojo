import { NodePath } from '@effect/platform-node'
import { app, BrowserWindow, session } from 'electron'
import { Config, Effect, Option, Path } from 'effect'

const developmentRendererUrl = Effect.runSync(
  Config.option(Config.url('DOJO_RENDERER_URL')),
)

const isLocalDevelopmentUrl = (url: URL): boolean =>
  url.protocol === 'http:' &&
  (url.hostname === '127.0.0.1' || url.hostname === 'localhost')

const validatedDevelopmentRendererUrl = Effect.runSync(
  Option.match(developmentRendererUrl, {
    onNone: () => Effect.succeedNone,
    onSome: url =>
      isLocalDevelopmentUrl(url)
        ? Effect.succeedSome(url)
        : Effect.die(
            new Error('DOJO_RENDERER_URL must be a local HTTP URL'),
          ),
  }),
)

const { appIconPath, developmentRendererOrigin, rendererPath } = Effect.runSync(
  Effect.gen(function* () {
    const path = yield* Path.Path
    const applicationDirectory = path.dirname(
      yield* path.fromFileUrl(new URL(import.meta.url)),
    )
    return {
      appIconPath: path.resolve(applicationDirectory, '../assets/icon.png'),
      developmentRendererOrigin: Option.map(
        validatedDevelopmentRendererUrl,
        url => url.origin,
      ),
      rendererPath: app.isPackaged
        ? path.join(process.resourcesPath, 'app', 'index.html')
        : path.resolve(applicationDirectory, '../../app/dist/index.html'),
    }
  }).pipe(Effect.provide(NodePath.layer), Effect.orDie),
)

const isAllowedNavigation = (url: string): boolean =>
  Option.match(developmentRendererOrigin, {
    onNone: () => url.startsWith('file:'),
    onSome: origin => new URL(url).origin === origin,
  })

const canWriteClipboard = (permission: string, url: string): boolean =>
  permission === 'clipboard-sanitized-write' && isAllowedNavigation(url)

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    title: 'Dojo',
    icon: appIconPath,
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#071020',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  })

  const load = Option.match(validatedDevelopmentRendererUrl, {
    onNone: () => window.loadFile(rendererPath),
    onSome: url => window.loadURL(url.href),
  })
  void load.catch(error => {
    process.stderr.write(`Failed to load the Dojo renderer: ${String(error)}\n`)
    app.quit()
  })

  return window
}

app.setName('Dojo')
app.setAboutPanelOptions({ applicationName: 'Dojo' })
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  void app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.setIcon(appIconPath)

    session.defaultSession.setPermissionCheckHandler(
      (webContents, permission) =>
        webContents !== null &&
        canWriteClipboard(permission, webContents.getURL()),
    )
    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        callback(canWriteClipboard(permission, webContents.getURL()))
      },
    )
    createWindow()
  })
}

app.on('second-instance', () => {
  const [mainWindow] = BrowserWindow.getAllWindows()
  if (mainWindow === undefined) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
