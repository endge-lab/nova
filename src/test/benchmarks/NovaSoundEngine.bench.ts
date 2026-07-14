import { beforeAll, bench, describe } from 'vitest'
import { createTestApp, installCanvasMocks } from '@/test/helpers/novaTestHarness'

const benchOptions = {
  iterations: 5,
  warmupIterations: 1,
  time: 10,
  warmupTime: 5,
}

const CLICK_SOUND = {
  id: 'bench.click',
  src: ['click.mp3', 'click.ogg'],
  cooldownMs: 0,
}

installCanvasMocks()

describe('Nova Sound Engine benchmarks', () => {
  const cacheApp = createTestApp({ sound: { formats: ['ogg', 'mp3'] } })
  const playbackApp = createTestApp({ sound: { maxVoices: 64 } })
  const poolApp = createTestApp({ sound: { maxVoices: 16 } })
  const dispatchApp = createTestApp()
  const dispatchSurface = dispatchApp.createSurface('sound-dispatch')
  const plainNode = dispatchSurface.createNode().options({ width: 10, height: 10 })
  const soundNode = dispatchSurface.createNode().options({ width: 10, height: 10 })

  beforeAll(async () => {
    await cacheApp.sound.load(CLICK_SOUND)
    await playbackApp.sound.load({ id: 'bench.one-shot', src: 'one-shot.ogg' })
    await poolApp.sound.load({ id: 'bench.hover', src: 'hover.ogg', cooldownMs: 30, maxInstances: 1 })
    await dispatchApp.sound.load({ id: 'bench.dispatch', src: 'dispatch.ogg' })

    plainNode.on('click', () => undefined)
    soundNode.withSound({ click: { id: 'bench.dispatch', dedupeKey: 'dispatch-click' } })
  })

  bench('sound.load cache hit: repeated descriptor load', async () => {
    for (let index = 0; index < 1_000; index += 1) {
      await cacheApp.sound.load(CLICK_SOUND)
    }
    if (cacheApp.sound.stats().decoded !== 1) {
      throw new Error('Sound cache decoded the same descriptor more than once')
    }
  }, benchOptions)

  bench('sound.play one-shot: 10k mocked play calls', () => {
    playbackApp.sound.stop()
    for (let index = 0; index < 10_000; index += 1) {
      playbackApp.sound.play('bench.one-shot', { dedupeKey: `one-shot-${index}` }).stop()
    }
    if (playbackApp.sound.stats().active !== 0) {
      throw new Error('One-shot benchmark leaked active handles')
    }
  }, benchOptions)

  bench('sound.voice pool: 1k rapid hover events stay bounded', () => {
    poolApp.sound.stop()
    for (let index = 0; index < 1_000; index += 1) {
      poolApp.sound.play('bench.hover', { dedupeKey: 'hover-tile' })
    }
    if (poolApp.sound.stats().active > 16) {
      throw new Error('Voice pool exceeded configured maxVoices')
    }
  }, benchOptions)

  bench('node.dispatch click without sound hooks', () => {
    const event = new MouseEvent('click')
    for (let index = 0; index < 10_000; index += 1) {
      plainNode.eventHandlers.click?.(event)
    }
  }, benchOptions)

  bench('node.withSound dispatch click with sound hooks', () => {
    const event = new MouseEvent('click')
    dispatchApp.sound.stop()
    for (let index = 0; index < 10_000; index += 1) {
      soundNode.eventHandlers.click?.(event)
    }
    dispatchApp.sound.stop()
  }, benchOptions)
})
