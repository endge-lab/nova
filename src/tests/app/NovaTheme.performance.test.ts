import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NovaNode,
  NovaPhase,
  type NovaApp,
  type NovaSurface,
} from '@/index'
import {
  createTestApp,
  installCanvasMocks,
} from '@/tests/helpers/novaTestHarness'

type TestEvents = Record<string, any>

class ThemePerfNode extends NovaNode<TestEvents> {
  updates = 0

  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface)
    app.theme.observe(this, { phase: NovaPhase.Update })
  }

  update(): void {
    this.updates += 1
  }
}

describe('Nova theme runtime performance', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('resolves active theme tokens inside a hot-path budget', () => {
    const app = createTestApp<TestEvents>()
    const tokenCount = 128
    const readCount = 50_000

    app.theme.register({
      id: 'bench',
      tokens: Object.fromEntries(
        Array.from({ length: tokenCount }, (_item, index) => [
          `--nova-bench-${index}`,
          `#${index.toString(16).padStart(6, '0')}`,
        ]),
      ),
    })

    let checksum = 0
    const start = performance.now()
    for (let index = 0; index < readCount; index += 1) {
      checksum += app.theme.resolve(`--nova-bench-${index % tokenCount}`, '#000000')?.length ?? 0
    }
    const elapsed = performance.now() - start

    console.info(`[NovaThemePerf] resolve ${readCount} tokens / ${tokenCount} theme tokens: ${elapsed.toFixed(2)} ms`)
    expect(checksum).toBe(readCount * 7)
    expect(elapsed).toBeLessThan(350)

    app.destroy()
  })

  it('delivers one theme switch to many subscribed nodes inside a mock frame budget', () => {
    const app = createTestApp<TestEvents>()
    app.theme.registerMany([
      {
        id: 'light',
        tokens: {
          '--nova-scene-bg': '#ffffff',
        },
      },
      {
        id: 'dark',
        tokens: {
          '--nova-scene-bg': '#080d18',
        },
      },
    ])

    const nodeCount = 1_000
    const surface = app.createSurface('theme-fanout')
    const nodes = Array.from({ length: nodeCount }, () => surface.createNode(ThemePerfNode))
    const before = nodes.reduce((sum, node) => sum + node.updates, 0)

    const start = performance.now()
    app.theme.use('dark')
    app.raph.run()
    const elapsed = performance.now() - start
    const delivered = nodes.reduce((sum, node) => sum + node.updates, 0) - before

    console.info(`[NovaThemePerf] Raph theme fanout / ${nodeCount} subscribers: ${elapsed.toFixed(2)} ms`)
    expect(app.theme.active()).toBe('dark')
    expect(delivered).toBeGreaterThanOrEqual(nodeCount)
    expect(elapsed).toBeLessThan(250)

    app.destroy()
  })
})
