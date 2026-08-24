import { _electron as electron, expect, test } from '@playwright/test'

test('the desktop app navigates from the Dojo menu', async (
  { browserName: _browserName },
  testInfo,
) => {
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${testInfo.outputPath('electron-profile')}`],
    cwd: new URL('../packages/desktop/', import.meta.url).pathname,
  })

  try {
    const window = await application.firstWindow()
    await expect(window.getByTestId('dojo-art')).toBeVisible()
    await window.getByRole('link', { name: 'Sketch' }).click()
    await expect(window.getByTestId('sketch-workspace')).toBeVisible()
    await expect(window.getByTestId('sketch-editor')).toBeVisible()
    await expect(window.getByRole('button', { name: 'Draw' })).toBeEnabled()

    const editor = window.getByTestId('sketch-editor')
    const bounds = await editor.boundingBox()
    expect(bounds).not.toBeNull()
    if (!bounds) return

    await window.mouse.move(
      bounds.x + bounds.width * 0.3,
      bounds.y + bounds.height * 0.35,
    )
    await window.mouse.down()
    await window.mouse.move(
      bounds.x + bounds.width * 0.65,
      bounds.y + bounds.height * 0.62,
      { steps: 8 },
    )
    await window.mouse.up()

    await window.getByRole('button', { name: 'Copy image' }).click()
    await expect(
      window.getByRole('button', { name: 'Copied image to clipboard.' }),
    ).toBeVisible()
    expect(
      await application.evaluate(({ clipboard }) => clipboard.readImage().isEmpty()),
    ).toBe(false)
  } finally {
    await application.close()
  }
})

test('the desktop app persists OpenAI credentials across restarts', async (
  { browserName: _browserName },
  testInfo,
) => {
  const userDataDirectory = testInfo.outputPath('electron-profile')
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${userDataDirectory}`],
      cwd: new URL('../packages/desktop/', import.meta.url).pathname,
    })
  const application = await launch()

  try {
    const window = await application.firstWindow()
    await window.getByRole('link', { name: 'Settings' }).click()
    await window.locator('#openai-api-key').fill('sk-dojo-desktop-test-key')
    await window.waitForFunction(() =>
      localStorage
        .getItem('dojo.openai-api-key.v1')
        ?.includes('sk-dojo-desktop-test-key')
    )
  } finally {
    await application.close()
  }

  const restartedApplication = await launch()
  try {
    const window = await restartedApplication.firstWindow()
    await window.getByRole('link', { name: 'Settings' }).click()
    await expect(window.locator('#openai-api-key')).toHaveValue(
      'sk-dojo-desktop-test-key',
    )
  } finally {
    await restartedApplication.close()
  }
})
