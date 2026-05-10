import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Nova, RaphSchedulerType, RendererType, type NovaApp } from '@/index'
import { createCanvas, createTestApp, installCanvasMocks } from '@/tests/helpers/novaTestHarness'

type TestEvents = Record<string, any>

const CLICK_SOUND = {
  id: 'ui.click',
  src: ['click.mp3', 'click.ogg'],
  cooldownMs: 40,
  maxInstances: 2,
}

describe('NovaSoundEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('loads descriptors once and resolves source by format preference', async () => {
    const app = createTestApp({ sound: { formats: ['ogg', 'mp3'] } })

    await app.sound.load(CLICK_SOUND)
    await app.sound.load(CLICK_SOUND)

    expect(app.sound.stats().loaded).toBe(1)
    expect(app.sound.stats().decoded).toBe(1)
    expect((app.sound as any).assets.get('ui.click').source).toBe('click.ogg')

    app.destroy()
  })

  it('plays noop handles and applies cooldown skips', async () => {
    vi.useFakeTimers()
    const app = createTestApp()
    await app.sound.load(CLICK_SOUND)

    const first = app.sound.play('ui.click')
    const second = app.sound.play('ui.click')

    expect(first.state).toBe('playing')
    expect(second.state).toBe('stopped')
    expect(app.sound.stats().played).toBe(1)
    expect(app.sound.stats().skipped).toBe(1)

    vi.advanceTimersByTime(1)
    await first.ended

    expect(app.sound.stats().active).toBe(0)
    app.destroy()
  })

  it('enforces voice pool and stop variants', async () => {
    vi.useFakeTimers()
    const app = createTestApp({ sound: { maxVoices: 1 } })
    await app.sound.load([
      { id: 'low', src: 'low.ogg', priority: 0 },
      { id: 'high', src: 'high.ogg', priority: 10 },
    ])

    const low = app.sound.play('low', { dedupeKey: 'low-1' })
    const high = app.sound.play('high', { dedupeKey: 'high-1' })

    expect(low.state).toBe('stopped')
    expect(high.state).toBe('playing')
    expect(app.sound.stats().active).toBe(1)

    app.sound.stop('high')
    expect(high.state).toBe('stopped')
    expect(app.sound.stats().active).toBe(0)
    app.destroy()
  })

  it('stops scoped and node-scoped handles on cleanup', async () => {
    vi.useFakeTimers()
    const app = createTestApp()
    await app.sound.load({ id: 'loop', src: 'loop.ogg', loop: true })
    const scope = app.sound.scope('test')
    const scoped = scope.play('loop', { dedupeKey: 'scoped' })
    const surface = app.createSurface('sound')
    const node = surface.createNode().withSound({ click: { id: 'loop', dedupeKey: 'node' } })

    node.eventHandlers.click?.(new MouseEvent('click'))
    expect(app.sound.stats().active).toBe(2)

    scope.destroy()
    expect(scoped.state).toBe('stopped')
    expect(app.sound.stats().active).toBe(1)

    node.dispose()
    expect(app.sound.stats().active).toBe(0)
    app.destroy()
  })

  it('unlocks from first pointer input and dispatches node sound after hit-test click', async () => {
    vi.useFakeTimers()
    const app = createPointerApp()
    await app.sound.load({ id: 'ui.click', src: 'click.ogg' })
    const surface = app.createSurface('sound-input')
    const node = surface.createNode().options({ width: app.width, height: app.height })
    node.withSound({ click: 'ui.click' })

    app.handleEvent('mousedown', new MouseEvent('mousedown', { clientX: 4, clientY: 4, button: 0 }))
    app.handleEvent('mouseup', new MouseEvent('mouseup', { clientX: 4, clientY: 4, button: 0 }))
    vi.advanceTimersByTime(260)
    await Promise.resolve()

    expect(app.sound.stats().unlocked).toBe(true)
    expect(app.sound.stats().played).toBe(1)
    app.destroy()
  })
})

/**
 * Создает NovaApp с включенным pointer input.
 */
function createPointerApp(): NovaApp<TestEvents> {
  return Nova.createApp<TestEvents>({
    target: createCanvas(),
    size: { width: 320, height: 180, maxDpr: 2 },
    input: {
      pointer: { enabled: true },
      keyboard: { enabled: false, scope: 'manual' },
    },
    renderer: { main: RendererType.Web2D },
    scheduler: { type: RaphSchedulerType.Sync, loop: false },
  })
}
