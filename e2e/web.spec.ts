import { expect, test } from '@playwright/test'

test('the main menu navigates between Foldkit routes', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('dojo-art')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dojo' })).toBeVisible()
  await page.getByRole('link', { name: 'Sketch' }).click()
  await expect(page).toHaveURL(/\/sketch$/)
  await expect(page.getByTestId('sketch-splash')).toBeVisible()

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
