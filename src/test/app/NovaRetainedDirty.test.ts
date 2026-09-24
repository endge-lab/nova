import type { EventList } from '@endge/utils'
import type { NovaApp, NovaSurface } from '@/index'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NovaNode } from '@/index'
import { createTestApp, installCanvasMocks } from '@/test/helpers/novaTestHarness'

type TestEvents = EventList

/**
 * Описывает Nova-node RetainedAuditNode и его runtime-поведение.
 */
class RetainedAuditNode extends NovaNode<TestEvents> {
  renderCount = 0

  /**
   * Создает экземпляр RetainedAuditNode и подготавливает базовое состояние.
   */
  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface)
  }

  /**
   * Выполняет отрисовку RetainedAuditNode.
   */
  override render(): void {
    this.renderCount += 1
  }
}

describe('жизненный цикл retained dirty в Nova', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('повышает retained dirty до полной компиляции, если у узла ещё нет retained handles', () => {
    const app = createTestApp<TestEvents>()
    const surface = app.createSurface('late-retained')
    const node = surface.createNode(RetainedAuditNode)

    node.dirty({ render: true })
    app.raph.run()

    expect(node.renderCount).toBeGreaterThan(0)

    node.renderCount = 0
    node.dirtyRetainedRender()
    app.raph.run()

    expect(node.renderCount).toBe(1)
    expect(surface.renderMetrics?.nodeRenderCalls).toBeGreaterThan(0)
  })

  it('не включает узлы с неготовым layout в кадры render до разрешения layout', () => {
    const app = createTestApp<TestEvents>()
    const surface = app.createSurface('layout-ready')
    const node = surface.createNode(RetainedAuditNode)

    node.layoutReady = false
    node.dirty({ render: true })
    app.raph.run()

    expect(node.renderCount).toBe(0)

    node.layoutReady = true
    app.raph.run()

    expect(node.renderCount).toBe(1)
  })
})
