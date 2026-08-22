import { expect, test } from '@playwright/test'

test('pages preserve the canonical scene composition', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1200 })
  await page.goto('/sketch')

  const stage = await page.getByTestId('scene-stage').boundingBox()
  expect(stage).not.toBeNull()
  if (!stage) return
  expect(stage.width).toBeCloseTo(900, 1)
  expect(stage.height).toBeCloseTo(540, 1)
  expect(stage.x).toBeCloseTo(0, 1)
  expect(stage.y).toBeCloseTo(330, 1)
})

test('settings controls retain usable mobile hit areas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve()
  })
  await page.goto('/settings')

  const masterVolume = page.getByRole('slider', { name: 'Master Volume' })
  const bounds = await masterVolume.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return
  expect(bounds.width).toBeGreaterThanOrEqual(40)
  expect(bounds.height).toBeGreaterThanOrEqual(40)

  const homeButton = page.getByRole('button', { name: 'Return to Dojo' })
  const homeBounds = await homeButton.boundingBox()
  expect(homeBounds).not.toBeNull()
  if (!homeBounds) return
  expect(homeBounds.width).toBeGreaterThanOrEqual(40)
  expect(homeBounds.height).toBeGreaterThanOrEqual(40)
})

test('the main menu navigates between Foldkit routes', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('dojo-art')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dojo' })).toBeVisible()
  await page.getByRole('link', { name: 'Sketch' }).click()
  await expect(page).toHaveURL(/\/sketch$/)
  await expect(page.getByTestId('sketch-workspace')).toBeVisible()
  await expect(page.getByTestId('sketch-editor')).toBeVisible()
  const music = page.locator('audio[data-dojo-background-music]')
  await expect(music).toHaveCount(1)
  await expect
    .poll(() => music.evaluate(element => Reflect.get(element, 'paused')))
    .toBe(false)

  await page.goBack()
  await page.getByRole('link', { name: 'Archivify' }).click()
  await expect(page).toHaveURL(/\/archivify$/)
  await expect(page.getByTestId('archivify-page')).toBeVisible()
  await expect(page.getByTestId('archivify-splash')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Archivify' })).toBeVisible()
  const featureHome = page.getByRole('link', { name: 'Return to Dojo' })
  await expect(page.locator('.dojo-page-home-label')).toHaveCSS('opacity', '1')
  await expect(page.locator('.dojo-page-home-icon')).toHaveCSS('opacity', '0')
  await featureHome.hover()
  await expect(page.locator('.dojo-page-home-label')).toHaveCSS('opacity', '0')
  await expect(page.locator('.dojo-page-home-icon')).toHaveCSS('opacity', '1')
  await featureHome.click()
  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('link', { name: 'Interrogation' }).click()
  await expect(page).toHaveURL(/\/interrogation$/)
  await expect(page.getByTestId('interrogation-splash')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Interrogation' })).toBeVisible()
  await page.getByRole('link', { name: 'Return to Dojo' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('link', { name: 'Interview' }).click()
  await expect(page.getByTestId('interview-splash')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Interview' })).toBeVisible()
  await page.getByRole('link', { name: 'Return to Dojo' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.goto('/settings')
  await expect(page.getByTestId('settings-page')).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Master Volume' })).toBeVisible()
  const settingsHomeButton = page.getByRole('button', {
    name: 'Return to Dojo',
  })
  const settingsHomeMark = page.locator('.settings-home-mark')
  const settingsHomeLabel = page.locator('.settings-home-label')
  const settingsHomeIcon = page.locator('.settings-home-icon')
  const settingsHomeBounds = await settingsHomeButton.boundingBox()
  const settingsHomeMarkBounds = await settingsHomeMark.boundingBox()
  expect(settingsHomeBounds).not.toBeNull()
  expect(settingsHomeMarkBounds).not.toBeNull()
  if (!settingsHomeBounds || !settingsHomeMarkBounds) return
  expect(settingsHomeBounds.width / settingsHomeMarkBounds.width).toBeCloseTo(1.5, 1)
  expect(settingsHomeBounds.height / settingsHomeMarkBounds.height).toBeCloseTo(1.5, 1)
  await expect(settingsHomeLabel).toHaveCSS('opacity', '1')
  await expect(settingsHomeIcon).toHaveCSS('opacity', '0')
  await settingsHomeButton.hover()
  await expect(settingsHomeLabel).toHaveCSS('opacity', '0')
  await expect(settingsHomeIcon).toHaveCSS('opacity', '1')
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
})

test('audio settings apply immediately and persist locally', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve()
  })
  await page.goto('/settings')

  const music = page.locator('audio[data-dojo-background-music]')
  await expect(music).toHaveCount(1)
  await expect
    .poll(() => music.evaluate(element => Reflect.get(element, 'volume')))
    .toBeCloseTo(0.315, 3)

  const masterVolume = page.getByRole('slider', { name: 'Master Volume' })
  const musicVolume = page.getByRole('slider', { name: 'Music Volume' })
  const voiceVolume = page.getByRole('slider', { name: 'Voice Volume' })
  const soundEffectsVolume = page.getByRole('slider', {
    name: 'Sound Effects Volume',
  })

  await masterVolume.press('End')
  await musicVolume.press('End')
  await voiceVolume.press('Home')
  await soundEffectsVolume.press('End')

  await expect(masterVolume).toHaveAttribute('aria-valuenow', '100')
  await expect(musicVolume).toHaveAttribute('aria-valuenow', '100')
  await expect(voiceVolume).toHaveAttribute('aria-valuenow', '0')
  await expect(soundEffectsVolume).toHaveAttribute('aria-valuenow', '100')
  await expect
    .poll(() => music.evaluate(element => Reflect.get(element, 'volume')))
    .toBe(1)
  await page.waitForFunction(() => {
    const stored = localStorage.getItem('dojo.audio-settings.v1')
    return (
      stored?.includes('"masterVolume":100') === true &&
      stored.includes('"musicVolume":100') &&
      stored.includes('"voiceVolume":0') &&
      stored.includes('"soundEffectsVolume":100')
    )
  })

  await page.reload()
  await expect(
    page.getByRole('slider', { name: 'Master Volume' }),
  ).toHaveAttribute('aria-valuenow', '100')
  await expect(
    page.getByRole('slider', { name: 'Music Volume' }),
  ).toHaveAttribute('aria-valuenow', '100')
  await expect(
    page.getByRole('slider', { name: 'Voice Volume' }),
  ).toHaveAttribute('aria-valuenow', '0')
  await expect(
    page.getByRole('slider', { name: 'Sound Effects Volume' }),
  ).toHaveAttribute('aria-valuenow', '100')
})

test('audio settings fall back when local storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Storage is unavailable', 'SecurityError')
      },
    })
    HTMLMediaElement.prototype.play = () => Promise.resolve()
  })
  await page.goto('/settings')

  const masterVolume = page.getByRole('slider', { name: 'Master Volume' })
  await expect(masterVolume).toHaveAttribute('aria-valuenow', '70')
  await masterVolume.press('End')
  await expect(masterVolume).toHaveAttribute('aria-valuenow', '100')
})

test('playback ignores stale attempts and retries after interaction', async ({ page }) => {
  await page.addInitScript(() => {
    const attempts: Array<
      Readonly<{ resolve: () => void; reject: () => void }>
    > = []
    Reflect.set(window, 'dojoMusicAttempts', attempts)
    HTMLMediaElement.prototype.play = () =>
      new Promise<void>((resolve, reject) => {
        attempts.push({
          resolve,
          reject: () => reject(new DOMException('Playback blocked', 'NotAllowedError')),
        })
      })
  })
  await page.goto('/settings')

  const status = page.getByTestId('settings-playback-status')
  const attemptCount = () =>
    page.evaluate(() => {
      const attempts = Reflect.get(window, 'dojoMusicAttempts')
      return Array.isArray(attempts) ? attempts.length : 0
    })
  const settleAttempt = (
    index: number,
    outcome: 'resolve' | 'reject',
  ) =>
    page.evaluate(
      ({ attemptIndex, attemptOutcome }) => {
        const attempts = Reflect.get(window, 'dojoMusicAttempts')
        if (!Array.isArray(attempts)) return
        const attempt = attempts[attemptIndex]
        if (typeof attempt !== 'object' || attempt === null) return
        const settle = Reflect.get(attempt, attemptOutcome)
        if (typeof settle === 'function') Reflect.apply(settle, attempt, [])
      },
      { attemptIndex: index, attemptOutcome: outcome },
    )

  await expect(status).toContainText('Starting music')
  await expect.poll(attemptCount).toBe(1)

  await page.keyboard.press('x')
  await expect.poll(attemptCount).toBe(2)
  await settleAttempt(0, 'resolve')
  await expect(status).toContainText('Starting music')

  await settleAttempt(1, 'reject')
  await expect(status).toContainText('Ready when you are')

  await page.keyboard.press('x')
  await expect.poll(attemptCount).toBe(3)
  await settleAttempt(2, 'resolve')
  await expect(status).toContainText('Now playing')
  await expect.poll(attemptCount).toBe(3)
})

test('the web app is installable as a PWA', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium')

  await page.goto('/')
  await page.waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration()))

  const session = await page.context().newCDPSession(page)
  const { installabilityErrors } = await session.send(
    'Page.getInstallabilityErrors',
  )
  expect(installabilityErrors).toEqual([])
})

test('the sketch persists drawings and clears them by shortcut', async ({ page }) => {
  await page.goto('/sketch')
  await expect(page.getByRole('button', { name: 'Draw' })).toBeEnabled()
  await expect(page.locator('.sketch-action-hint')).toHaveText([
    'Ctrl C',
    'Ctrl Enter',
  ])
  const blackSwatch = page.getByRole('button', { name: 'Use black' })
  const redSwatch = page.getByRole('button', { name: 'Use red' })
  await expect(blackSwatch).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Shift+a')
  await expect(redSwatch).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Shift+d')
  await expect(blackSwatch).toHaveAttribute('aria-pressed', 'true')

  const editor = page.getByTestId('sketch-editor')
  const bounds = await editor.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return

  const strokeStart = {
    x: bounds.x + bounds.width * 0.3,
    y: bounds.y + bounds.height * 0.35,
  }
  await page.mouse.move(strokeStart.x, strokeStart.y)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.62, {
    steps: 8,
  })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Clear' })).toBeEnabled()
  const strokeBounds = await editor.locator('.tl-shape').boundingBox()
  expect(strokeBounds).not.toBeNull()
  if (!strokeBounds) return
  expect(strokeBounds.x).toBeCloseTo(strokeStart.x, 0)
  expect(strokeBounds.y).toBeCloseTo(strokeStart.y, 0)
  await page.waitForFunction(() => {
    const sync = Reflect.get(window, 'tlsync')
    return (
      typeof sync === 'object' &&
      sync !== null &&
      Reflect.get(sync, 'scheduledPersistTimeout') === null &&
      Reflect.get(sync, 'isPersisting') === false
    )
  })

  await page.reload()
  await expect(page.getByRole('button', { name: 'Draw' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Clear' })).toBeEnabled()

  await page.keyboard.press('Control+c')
  await expect(page.getByRole('button', { name: 'Clear' })).toBeDisabled()

  await page.getByRole('button', { name: 'Return to Dojo' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Dojo' })).toBeVisible()
})
