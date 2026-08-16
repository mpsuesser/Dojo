import { expect, test } from '@playwright/test'

test('the web app displays the Dojo art and PWA manifest', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('dojo-art')).toBeVisible()
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
