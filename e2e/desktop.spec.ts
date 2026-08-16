import { _electron as electron, expect, test } from '@playwright/test'

test('the desktop app displays the Dojo art', async () => {
  const application = await electron.launch({
    args: ['.'],
    cwd: new URL('../packages/desktop/', import.meta.url).pathname,
  })

  try {
    const window = await application.firstWindow()
    await expect(window.getByTestId('dojo-art')).toBeVisible()
  } finally {
    await application.close()
  }
})
