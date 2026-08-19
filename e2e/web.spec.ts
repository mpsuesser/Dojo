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

test('the main menu navigates between Foldkit routes', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('dojo-art')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dojo' })).toBeVisible()
  await page.getByRole('link', { name: 'Sketch' }).click()
  await expect(page).toHaveURL(/\/sketch$/)
  await expect(page.getByTestId('sketch-workspace')).toBeVisible()
  await expect(page.getByTestId('sketch-editor')).toBeVisible()

  await page.goBack()
  await page.getByRole('link', { name: 'Archivify' }).click()
  await expect(page).toHaveURL(/\/archivify$/)
  await expect(page.getByTestId('archivify-page')).toBeVisible()

  await page.goBack()
  await page.getByRole('link', { name: 'Interrogation' }).click()
  await expect(page).toHaveURL(/\/interrogation$/)
  await expect(page.getByTestId('interrogation-splash')).toBeVisible()

  await page.goto('/interview')
  await expect(page.getByTestId('interview-splash')).toBeVisible()

  await page.goto('/settings')
  await expect(page.getByTestId('settings-splash')).toBeVisible()
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
})

test('the web app is installable as a PWA', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium')

  await page.goto('/')
  await page.waitForFunction(async () =>
    Boolean(await navigator.serviceWorker.getRegistration()),
  )

  const session = await page.context().newCDPSession(page)
  const { installabilityErrors } = await session.send(
    'Page.getInstallabilityErrors',
  )
  expect(installabilityErrors).toEqual([])
})

test('the sketch persists drawings and clears them directly', async ({
  page,
}) => {
  await page.goto('/sketch')
  await expect(page.getByRole('button', { name: 'Draw' })).toBeEnabled()

  const editor = page.getByTestId('sketch-editor')
  const bounds = await editor.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return

  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.35)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.62, {
    steps: 8,
  })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Clear' })).toBeEnabled()
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

  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByRole('button', { name: 'Clear' })).toBeDisabled()

  await page.getByRole('button', { name: 'Return to Dojo' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Dojo' })).toBeVisible()
})
