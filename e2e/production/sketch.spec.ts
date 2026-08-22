import { expect, test } from '@playwright/test'

test('the production sketch remains interactive past the license gate', async ({ page }) => {
  await page.goto('/sketch')

  const editor = page.getByTestId('sketch-editor')
  await expect(page.getByRole('button', { name: 'Draw' })).toBeEnabled()
  await expect(editor.locator('.tl-background')).toBeVisible()

  await page.waitForTimeout(6_000)

  await expect(page.getByTestId('tl-license-expired')).toHaveCount(0)
  await expect(editor.locator('.tl-background')).toBeVisible()

  const bounds = await editor.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return

  const shapes = editor.locator('.tl-shape')
  const initialShapeCount = await shapes.count()
  await page.mouse.move(
    bounds.x + bounds.width * 0.3,
    bounds.y + bounds.height * 0.35,
  )
  await page.mouse.down()
  await page.mouse.move(
    bounds.x + bounds.width * 0.65,
    bounds.y + bounds.height * 0.62,
    { steps: 8 },
  )
  await page.mouse.up()

  await expect.poll(() => shapes.count()).toBeGreaterThan(initialShapeCount)
})
