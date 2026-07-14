import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RaphKernel } from '@endge/raph'
import {
  NovaNode,
  NovaPhase,
  type NovaApp,
  type NovaSurface,
} from '@/index'
import { createTestApp, installCanvasMocks } from '@/test/helpers/novaTestHarness'

/**
 * Описывает Nova-node RuntimeAuditNode и его runtime-поведение.
 */
class RuntimeAuditNode extends NovaNode<Record<string, any>> {
  updates = 0
  matrices = 0
  renders = 0

  /**
   * Обновляет runtime-состояние RuntimeAuditNode.
   */
  override update(): void {
    this.updates += 1
  }

  /**
   * Выполняет действие doMatrix в рамках ответственности RuntimeAuditNode.
   */
  override doMatrix(): void {
    this.matrices += 1
    super.doMatrix()
  }

  /**
   * Выполняет отрисовку RuntimeAuditNode.
   */
  override render(): void {
    this.renders += 1
  }
}

function createAuditNode(
  app: NovaApp<Record<string, any>>,
  surface: NovaSurface<Record<string, any>>,
): RuntimeAuditNode {
  const node = new RuntimeAuditNode(app, surface)
  node.options({
    width: 10,
    height: 10,
  })
  surface.addChild(node)
  app.raph.run()
  node.updates = 0
  node.matrices = 0
  node.renders = 0
  return node
}

describe('Nova Raph runtime bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('creates a Nova runtime lane with custom RaphKernel and runtime id', () => {
    const kernel = new RaphKernel()
    const app = createTestApp({
      raph: {
        kernel,
        runtimeId: 'nova-main',
      },
    })

    expect(app.raph.id).toBe('nova-main')
    expect(app.raph.kernel).toBe(kernel)
    expect(app.raph.getPhase(NovaPhase.Update)).toBeDefined()
    expect(app.raph.getPhase(NovaPhase.Render)).toBeDefined()

    app.destroy()
  })

  it('keeps two Nova runtimes isolated on one kernel', () => {
    const kernel = new RaphKernel()
    const firstApp = createTestApp({ raph: { kernel, runtimeId: 'nova-a' } })
    const secondApp = createTestApp({ raph: { kernel, runtimeId: 'nova-b' } })
    const firstNode = createAuditNode(firstApp, firstApp.createSurface('first'))
    const secondNode = createAuditNode(secondApp, secondApp.createSurface('second'))

    firstNode.observeData('shared.first.version')
    secondNode.observeData('shared.second.version')

    kernel.set('shared.first.version', 1)
    firstApp.raph.run()
    secondApp.raph.run()

    expect(firstNode.updates).toBe(1)
    expect(secondNode.updates).toBe(0)

    firstApp.destroy()
    secondApp.destroy()
  })

  it('uses update phase as default observeData target', () => {
    const kernel = new RaphKernel()
    const app = createTestApp({ raph: { kernel, runtimeId: 'nova-default-update' } })
    const node = createAuditNode(app, app.createSurface('default-update'))

    node.observeData('items.default.version')
    kernel.set('items.default.version', 1)
    app.raph.run()

    expect(node.updates).toBe(1)
    expect(node.matrices).toBe(0)

    app.destroy()
  })

  it('allows observeData to target render phase explicitly', () => {
    const kernel = new RaphKernel()
    const app = createTestApp({ raph: { kernel, runtimeId: 'nova-render' } })
    const node = createAuditNode(app, app.createSurface('render'))

    node.observeData('items.render.version', {
      phase: NovaPhase.Render,
    })
    kernel.set('items.render.version', 1)
    app.raph.run()

    expect(node.updates).toBe(0)
    expect(node.renders).toBe(1)

    app.destroy()
  })

  it('allows observeData to target matrix phase explicitly', () => {
    const kernel = new RaphKernel()
    const app = createTestApp({ raph: { kernel, runtimeId: 'nova-matrix' } })
    const node = createAuditNode(app, app.createSurface('matrix'))

    node.observeData('items.matrix.version', {
      phase: NovaPhase.Matrix,
    })
    kernel.set('items.matrix.version', 1)
    app.raph.run()

    expect(node.updates).toBe(0)
    expect(node.matrices).toBe(1)

    app.destroy()
  })

  it('removes observeData subscriptions when node is disposed', () => {
    const kernel = new RaphKernel()
    const app = createTestApp({ raph: { kernel, runtimeId: 'nova-cleanup' } })
    const node = createAuditNode(app, app.createSurface('cleanup'))

    node.observeData('items.cleanup.version')
    node.dispose()

    kernel.set('items.cleanup.version', 1)
    app.raph.run()

    expect(node.updates).toBe(0)

    app.destroy()
  })

  it('keeps local properties on the instant Raph path', () => {
    const app = createTestApp()
    const node = createAuditNode(app, app.createSurface('local-properties'))

    const notifySpy = vi.spyOn(node.raph.kernel, 'notify')

    node.x = 12
    node.y = 24
    app.raph.run()

    expect(node.x).toBe(12)
    expect(node.y).toBe(24)
    expect(notifySpy).not.toHaveBeenCalled()

    app.destroy()
  })
})
