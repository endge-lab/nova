import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventList } from '@endge/utils'
import { NovaNode, type NovaApp, type NovaSurface } from '@/index'
import { createTestApp, installCanvasMocks } from '@/tests/helpers/novaTestHarness'

type TestEvents = EventList

class RetainedAuditNode extends NovaNode<TestEvents> {
  renderCount = 0

  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface)
  }

  override render(): void {
    this.renderCount += 1
  }
}

describe('Nova retained dirty lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('promotes retained dirty to full compile when a node has no retained handles yet', () => {
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
})
