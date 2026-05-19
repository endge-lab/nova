import { bench, describe, vi } from 'vitest'
import { RaphKernel } from '@endge/raph'
import {
  createNovaContextToken,
  NovaNode,
  NovaPhase,
  type NovaApp,
  type NovaSurface,
} from '@/index'
import { createTestApp, installCanvasMocks } from '@/tests/helpers/novaTestHarness'

/**
 * Описывает Nova-node BenchNode и его runtime-поведение.
 */
class BenchNode extends NovaNode<Record<string, any>> {
  updates = 0

  /**
   * Обновляет runtime-состояние BenchNode.
   */
  override update(): void {
    this.updates += 1
  }

  /**
   * Выполняет отрисовку BenchNode.
   */
  override render(): void {}
}

const benchOptions = {
  iterations: 3,
  warmupIterations: 1,
  time: 10,
  warmupTime: 5,
}

const INJECT_NODE_COUNT = 20_000
const REPARENT_NODE_COUNT = 2_000
const OBSERVER_COUNT = 10_000
const DATA_WRITE_COUNT = 1_000
const LOCAL_WRITE_COUNT = 100_000

installCanvasMocks()

const injectFixture = createInjectFixture(INJECT_NODE_COUNT)
const reparentFixture = createReparentFixture(REPARENT_NODE_COUNT)
const observeDataFixture = createObserveDataFixture()
const localPropertyFixture = createLocalPropertyFixture()

describe('Nova context/runtime benchmarks', () => {
  bench('provide/inject: 20k cached lookups', () => {
    for (const node of injectFixture.nodes) {
      node.inject(injectFixture.token)
    }
  }, benchOptions)

  bench('provide/inject: 20k cold nearest-provider lookups', () => {
    for (const node of injectFixture.nodes) {
      ;(node as any)._injectCache?.clear()
      node.inject(injectFixture.token)
    }
  }, benchOptions)

  bench('reparent invalidation: 2k subtree cache reset', () => {
    ;(reparentFixture.subtreeRoot as any).clearInjectCacheDeep()
  }, benchOptions)

  bench('observeData: 10k subscriptions / 1k writes / one affected runtime', () => {
    observeDataFixture.kernel.transaction(() => {
      for (let i = 0; i < DATA_WRITE_COUNT; i++) {
        observeDataFixture.kernel.set(`items.${i}.version`, i)
      }
    })
    for (const app of observeDataFixture.apps) {
      app.raph.run()
    }
  }, benchOptions)

  bench('local property fast path: 200k x/y writes without DataPath notify', () => {
    const { node, notifySpy } = localPropertyFixture

    for (let i = 0; i < LOCAL_WRITE_COUNT; i++) {
      node.x = i
      node.y = i
    }

    if (notifySpy.mock.calls.length > 0) {
      throw new Error('Local property fast path called DataPath notify')
    }
  }, benchOptions)
})

/**
 * Создает bench node.
 */
function createBenchNode(
  app: NovaApp<Record<string, any>>,
  surface: NovaSurface<Record<string, any>>,
): BenchNode {
  const node = new BenchNode(app, surface)
  surface.addChild(node, { invalidate: false })
  node.updates = 0
  return node
}

/**
 * Создает fixture для provide/inject bench.
 */
function createInjectFixture(count: number) {
  const app = createTestApp()
  const surface = app.createSurface('inject')
  const token = createNovaContextToken<{ id: number }>('bench.inject')
  const provider = createBenchNode(app, surface)
  const nodes: Array<BenchNode> = []

  provider.provide(token, { id: 1 })
  for (let i = 0; i < count; i++) {
    const node = new BenchNode(app, surface)
    ;(node as any)._parent = provider
    provider.children.push(node)
    nodes.push(node)
  }

  return {
    app,
    token,
    nodes,
  }
}

/**
 * Создает fixture для reparent cache invalidation bench.
 */
function createReparentFixture(count: number) {
  const app = createTestApp()
  const surface = app.createSurface('reparent')
  const token = createNovaContextToken<{ id: number }>('bench.reparent')
  const sourceParent = createBenchNode(app, surface)
  const targetParent = new BenchNode(app, surface)
  const subtreeRoot = new BenchNode(app, surface)

  sourceParent.provide(token, { id: 1 })
  targetParent.provide(token, { id: 2 })
  surface.addChild(targetParent, { invalidate: false })
  ;(subtreeRoot as any)._parent = sourceParent
  sourceParent.children.push(subtreeRoot)

  for (let i = 0; i < count; i++) {
    const child = new BenchNode(app, surface)
    ;(child as any)._parent = subtreeRoot
    subtreeRoot.children.push(child)
    child.inject(token)
  }

  return {
    app,
    subtreeRoot,
  }
}

/**
 * Создает fixture для shared kernel observeData bench.
 */
function createObserveDataFixture() {
  const kernel = new RaphKernel()
  const apps = [
    createTestApp({ raph: { kernel, runtimeId: 'nova-bench-a' } }),
    createTestApp({ raph: { kernel, runtimeId: 'nova-bench-b' } }),
    createTestApp({ raph: { kernel, runtimeId: 'nova-bench-c' } }),
  ]

  for (let runtimeIndex = 0; runtimeIndex < apps.length; runtimeIndex++) {
    const app = apps[runtimeIndex]
    const surface = app.createSurface(`runtime-${runtimeIndex}`)
    const node = createBenchNode(app, surface)
    if (runtimeIndex === 0) {
      for (let i = 0; i < OBSERVER_COUNT; i++) {
        node.observeData(`items.${i}.version`, {
          phase: NovaPhase.Update,
        })
      }
    }
    app.raph.run()
  }

  return {
    kernel,
    apps,
  }
}

/**
 * Создает fixture для local property fast path bench.
 */
function createLocalPropertyFixture() {
  const app = createTestApp()
  const surface = app.createSurface('local')
  const node = createBenchNode(app, surface)
  const notifySpy = vi.spyOn(app.raph.kernel, 'notify')
  ;(app.raph as any).invalidate = () => {}

  return {
    app,
    node,
    notifySpy,
  }
}
