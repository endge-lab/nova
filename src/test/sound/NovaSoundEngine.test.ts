import type { NovaApp } from '@/index'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Nova, RaphSchedulerType, RendererType } from '@/index'
import { createCanvas, createTestApp, installCanvasMocks } from '@/test/helpers/novaTestHarness'

type TestEvents = Record<string, any>

const CLICK_SOUND = {
  id: 'ui.click',
  src: ['click.mp3', 'click.ogg'],
  cooldownMs: 40,
  maxInstances: 2,
}

describe('звуковой движок Nova', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('однократно загружает descriptors и разрешает Source по приоритету форматов', async () => {
    const app = createTestApp({ sound: { formats: ['ogg', 'mp3'] } })

    await app.sound.load(CLICK_SOUND)
    await app.sound.load(CLICK_SOUND)

    expect(app.sound.stats().loaded).toBe(1)
    expect(app.sound.stats().decoded).toBe(1)
    expect((app.sound as any)._assets.get('ui.click').source).toBe('click.ogg')

    app.destroy()
  })

  it('воспроизводит noop handles и применяет пропуски cooldown', async () => {
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

  it('обеспечивает ограничения пула голосов и варианты остановки', async () => {
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

  it('останавливает handles scope и узла при очистке', async () => {
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

  it('разблокируется при первом pointer input и отправляет звук узла после клика hit-test', async () => {
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
