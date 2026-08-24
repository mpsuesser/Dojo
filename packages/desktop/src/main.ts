import { OPENAI_API_KEYS_URL } from '@dojo/shared'
import { NodePath } from '@effect/platform-node'
import { Config, Effect, Layer, ManagedRuntime, Option, Path } from 'effect'
import { app, BrowserWindow, session, shell } from 'electron'

const electronRuntime = ManagedRuntime.make(Layer.empty)

const userDataDirectory = Effect.runSync(
  Config.option(Config.nonEmptyString('DOJO_USER_DATA_DIR')),
)

Option.match(userDataDirectory, {
  onNone: () => undefined,
  onSome: directory => app.setPath('userData', directory),
})

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

const { appIconPath, developmentRendererOrigin, rendererPath, rendererUrl } = Effect.runSync(
  Effect.gen(function* () {
    const path = yield* Path.Path
    const applicationDirectory = path.dirname(
      yield* path.fromFileUrl(new URL(import.meta.url)),
    )
    const rendererPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'index.html')
      : path.resolve(applicationDirectory, '../../app/dist/index.html')
    return {
      appIconPath: path.resolve(applicationDirectory, '../assets/icon.png'),
      developmentRendererOrigin: Option.map(
        validatedDevelopmentRendererUrl,
        url => url.origin,
      ),
      rendererPath,
      rendererUrl: (yield* path.toFileUrl(rendererPath)).href,
    }
  }).pipe(Effect.provide(NodePath.layer), Effect.orDie),
)

const isAllowedNavigation = (url: string): boolean =>
  Option.match(developmentRendererOrigin, {
    onNone: () => url === rendererUrl || url.startsWith(`${rendererUrl}#`),
    onSome: origin => new URL(url).origin === origin,
  })

const canUseRendererPermission = (
  permission: string,
  url: string,
  isMainFrame: boolean,
  mediaType?: string,
): boolean =>
  isMainFrame &&
  isAllowedNavigation(url) &&
  (permission === 'clipboard-sanitized-write' ||
    (permission === 'media' && mediaType === 'audio'))

const configureRendererPermissions = (window: BrowserWindow): void => {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      webContents?.id === window.webContents.id &&
      canUseRendererPermission(
        permission,
        details.requestingUrl ?? requestingOrigin,
        details.isMainFrame,
        details.mediaType,
      ),
  )
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaType = 'mediaTypes' in details && details.mediaTypes?.length === 1
        ? details.mediaTypes[0]
        : undefined
      callback(
        webContents.id === window.webContents.id &&
          canUseRendererPermission(
            permission,
            details.requestingUrl,
            details.isMainFrame,
            mediaType,
          ),
      )
    },
  )
}

const openAllowedExternalUrl = (url: string): void => {
  if (url !== OPENAI_API_KEYS_URL) return

  electronRuntime.runFork(
    Effect.tryPromise(() => shell.openExternal(url)).pipe(
      Effect.catch(error => Effect.logError('Failed to open an external URL.', error)),
    ),
  )
}

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
  configureRendererPermissions(window)
  window.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalUrl(url)
    return { action: 'deny' }
  })
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
app.once('will-quit', () => {
  void electronRuntime.dispose()
})
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  void app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.setIcon(appIconPath)
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
