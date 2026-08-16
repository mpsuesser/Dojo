import { expect, test } from '@playwright/test'

test('the web app displays the Dojo art and PWA manifest', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('dojo-art')).toBeVisible()
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
})
