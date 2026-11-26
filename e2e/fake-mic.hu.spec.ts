import { expect, test } from '@playwright/test'
import { fakeMic, peakLevelFromMic } from './support/fake-mic.ts'

test.use(fakeMic('hu-sample.wav'))

test.describe('fake microphone with the Hungarian clip', () => {
  test('delivers a live track playing the clip, not silence or the default beep', async ({
    page,
  }) => {
    await page.goto('/')
    const { live, peak } = await peakLevelFromMic(page)
    expect(live).toBe(true)
    expect(peak).toBeGreaterThan(0.1)
    expect(peak).toBeLessThan(0.6)
  })
})
