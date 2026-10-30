// Run with the local Vite server running: node scripts/test-shared-preview.mjs
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = process.env.SANDBOX_TEST_ORIGIN ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH })

async function shareUrl(page) {
  await page.goto(origin)
  return page.evaluate(async () => {
    const { encodeSandbox } = await import('/src/lib/share/index.ts')
    const { game, OPEN_MOVE } = await import('/src/lib/share/fixtures.test-helper.ts')
    const { classicalMap } = await import('/src/lib/maps/classical.ts')
    const sandbox = game(classicalMap, [[OPEN_MOVE]])
    return `${location.origin}/sandbox/s/${await encodeSandbox(sandbox)}`
  })
}

async function checkPreview(viewport) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const url = await shareUrl(page)
  await page.goto(url)
  await page.getByText('Preview', { exact: true }).waitFor()
  assert.equal(page.url(), url)
  assert.equal(await page.evaluate(() => localStorage.getItem('diplomacy:sandboxes')), null)
  assert.equal(await page.getByRole('button', { name: 'Delete sandbox' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Resolve', exact: true }).count(), 0)
  await page.locator('button[title="Previous phase"], button[aria-label="Previous phase"]').first().click()
  assert.equal(page.url(), url)
  assert.equal(await page.evaluate(() => localStorage.getItem('diplomacy:sandboxes')), null)
  await page.getByRole('button', { name: 'Save sandbox' }).click()
  await page.waitForURL(/\/sandbox\/(?!s\/)[^/?]+$/)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('diplomacy:sandboxes') ?? '[]'))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].cursor, 0)
  assert.equal(await page.getByText('Preview', { exact: true }).count(), 0)
  await page.goto(url)
  await page.getByText('Preview', { exact: true }).waitFor()
  const reopened = await page.evaluate(() => JSON.parse(localStorage.getItem('diplomacy:sandboxes') ?? '[]'))
  assert.equal(reopened.length, 1)
  await context.close()
}

try {
  await checkPreview({ width: 1440, height: 900 })
  await checkPreview({ width: 390, height: 844 })
  console.log('Shared preview and save passed on desktop and mobile')
} finally {
  await browser.close()
}
