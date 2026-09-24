import { beforeEach, describe, expect, it } from 'vitest'
import {
  Nova,
  NovaComponent,
  NovaComponentNode,
  Reactive,
  Store,
} from '@/index'
import { createTestApp, installCanvasMocks } from '@/test/helpers/novaTestHarness'

@Store()
class TestViewportStore {
  @Reactive({ phase: 'render' })
  scale = 1

  @Reactive({ phase: 'render' })
  x = 0
}

@Store()
class TestSelectionStore {
  @Reactive({ phase: 'render' })
  ids: Array<string> = []
}

@Store()
class TestAdvancedStore {
  itemId = 'a'

  @Reactive({ path: 'legacy.zoom', phase: 'render' })
  legacyScale = 1

  @Reactive({ path: self => `items.${self.itemId}.label`, phase: 'render' })
  label = 'Initial'

  @Reactive({ phase: ['update', 'render'] })
  collapsed = false

  @Reactive({ phase: 'render' })
  mode: 'scale' | 'selection' = 'scale'
}

@Store()
class TestStore {
  @Reactive()
  viewport = new TestViewportStore()

  @Reactive()
  selection = new TestSelectionStore()
}

const TEST_STORE = Nova.createContextToken<TestStore>('TestStore')
const TEST_ADVANCED_STORE = Nova.createContextToken<TestAdvancedStore>('TestAdvancedStore')

@NovaComponent({ type: 'test.store-reader' })
class StoreReader extends NovaComponentNode {
  renderCount = 0
  lastScale = 0

  override render(): void {
    const store = this.inject(TEST_STORE)
    this.lastScale = store.viewport.scale
    this.renderCount += 1
  }
}

@NovaComponent({ type: 'test.store-branch-reader' })
class StoreBranchReader extends NovaComponentNode {
  renderCount = 0
  lastViewport: TestViewportStore | null = null

  override render(): void {
    const store = this.inject(TEST_STORE)
    this.lastViewport = store.viewport
    this.renderCount += 1
  }
}

@NovaComponent({ type: 'test.store-advanced-reader' })
class StoreAdvancedReader extends NovaComponentNode {
  updateCount = 0
  renderCount = 0
  lastValue = ''
  lastCollapsed = false

  override update(): void {
    this.updateCount += 1
  }

  override render(): void {
    const store = this.inject(TEST_ADVANCED_STORE)
    this.lastValue = `${store.legacyScale}:${store.label}`
    this.lastCollapsed = store.collapsed
    this.renderCount += 1
  }
}

@NovaComponent({ type: 'test.store-conditional-reader' })
class StoreConditionalReader extends NovaComponentNode {
  renderCount = 0
  lastValue: unknown

  override render(): void {
    const store = this.inject(TEST_STORE)
    if ((store as any).advanced?.mode === 'selection') {
      this.lastValue = store.selection.ids.length
    }
    else {
      this.lastValue = store.viewport.scale
    }
    this.renderCount += 1
  }
}

beforeEach(() => {
  installCanvasMocks()
})

describe('декораторы Store Nova', () => {
  it('отслеживает чтение реактивных полей во время render и помечает только зависимые узлы', () => {
    const app = createTestApp()
    Nova.registerComponents(app.schema, StoreReader as never)
    const store = Nova.createStore(new TestStore(), { app, scope: 'store-test' })
    const surface = app.createSurface('store')
    surface.provide(TEST_STORE, store)
    const node = app.schema.createNode(surface, {
      type: 'test.store-reader',
      id: 'reader',
    }, { invalidate: false }) as StoreReader

    app.raph.run()
    expect(node.lastScale).toBe(1)
    expect(node.renderCount).toBe(1)

    store.selection.ids = ['a']
    app.raph.run()
    expect(node.renderCount).toBe(1)

    store.viewport.scale = 2
    app.raph.run()
    expect(node.lastScale).toBe(2)
    expect(node.renderCount).toBe(2)
  })

  it('отслеживает чтение листьев и ветвей при перестроении их общей retained-поверхности', () => {
    const app = createTestApp()
    Nova.registerComponents(app.schema, [StoreReader, StoreBranchReader] as never)
    const store = Nova.createStore(new TestStore(), { app, scope: 'branch-test' })
    const surface = app.createSurface('branch')
    surface.provide(TEST_STORE, store)
    const leaf = app.schema.createNode(surface, {
      type: 'test.store-reader',
      id: 'leaf',
    }, { invalidate: false }) as StoreReader
    const branch = app.schema.createNode(surface, {
      type: 'test.store-branch-reader',
      id: 'branch',
    }, { invalidate: false }) as StoreBranchReader

    app.raph.run()
    expect(leaf.renderCount).toBe(1)
    expect(branch.renderCount).toBe(1)

    store.viewport.x = 10
    app.raph.run()
    expect(leaf.renderCount).toBe(2)
    expect(branch.renderCount).toBe(2)

    store.viewport.scale = 3
    app.raph.run()
    expect(leaf.renderCount).toBe(3)
    expect(branch.renderCount).toBe(3)
  })

  it('объединяет записи Store в транзакции Raph', () => {
    const app = createTestApp()
    Nova.registerComponents(app.schema, StoreReader as never)
    const store = Nova.createStore(new TestStore(), { app, scope: 'batch-test' })
    const surface = app.createSurface('batch')
    surface.provide(TEST_STORE, store)
    const node = app.schema.createNode(surface, {
      type: 'test.store-reader',
      id: 'batch-reader',
    }, { invalidate: false }) as StoreReader

    app.raph.run()
    Nova.batchStore(store, () => {
      store.viewport.scale = 4
      store.viewport.scale = 5
    })
    app.raph.run()

    expect(node.lastScale).toBe(5)
    expect(node.renderCount).toBe(2)
  })

  it('поддерживает явные и динамические реактивные пути', () => {
    const app = createTestApp()
    Nova.registerComponents(app.schema, StoreAdvancedReader as never)
    const store = Nova.createStore(new TestAdvancedStore(), { app, scope: 'advanced-test' })
    const surface = app.createSurface('advanced')
    surface.provide(TEST_ADVANCED_STORE, store)
    const node = app.schema.createNode(surface, {
      type: 'test.store-advanced-reader',
      id: 'advanced-reader',
    }, { invalidate: false }) as StoreAdvancedReader

    app.raph.run()
    expect(node.lastValue).toBe('1:Initial')

    store.legacyScale = 2
    app.raph.run()
    expect(node.lastValue).toBe('2:Initial')

    store.label = 'Updated'
    app.raph.run()
    expect(node.lastValue).toBe('2:Updated')
  })

  it('регистрирует одно чтение поля для нескольких запрошенных фаз', () => {
    const app = createTestApp()
    Nova.registerComponents(app.schema, StoreAdvancedReader as never)
    const store = Nova.createStore(new TestAdvancedStore(), { app, scope: 'multi-phase-test' })
    const surface = app.createSurface('multi-phase')
    surface.provide(TEST_ADVANCED_STORE, store)
    const node = app.schema.createNode(surface, {
      type: 'test.store-advanced-reader',
      id: 'multi-phase-reader',
    }, { invalidate: false }) as StoreAdvancedReader

    app.raph.run()
    expect(node.updateCount).toBe(1)
    expect(node.renderCount).toBe(1)

    store.collapsed = true
    app.raph.run()
    expect(node.updateCount).toBe(2)
    expect(node.renderCount).toBe(2)
    expect(node.lastCollapsed).toBe(true)
  })

  it('заменяет условные зависимости после повторного render', () => {
    const app = createTestApp()
    Nova.registerComponents(app.schema, StoreConditionalReader as never)
    const store = Nova.createStore(new TestStore(), { app, scope: 'conditional-test' })
    ;(store as any).advanced = Nova.createStore(new TestAdvancedStore(), { app, scope: 'conditional-test' })
    const surface = app.createSurface('conditional')
    surface.provide(TEST_STORE, store)
    const node = app.schema.createNode(surface, {
      type: 'test.store-conditional-reader',
      id: 'conditional-reader',
    }, { invalidate: false }) as StoreConditionalReader

    app.raph.run()
    expect(node.lastValue).toBe(1)
    expect(node.renderCount).toBe(1)

    ;(store as any).advanced.mode = 'selection'
    app.raph.run()
    expect(node.lastValue).toBe(0)
    expect(node.renderCount).toBe(2)

    store.viewport.scale = 4
    app.raph.run()
    expect(node.renderCount).toBe(2)

    store.selection.ids = ['a', 'b']
    app.raph.run()
    expect(node.lastValue).toBe(2)
    expect(node.renderCount).toBe(3)
  })

  it('изолирует одинаковые пути по scope Store', () => {
    const app = createTestApp()
    Nova.registerComponents(app.schema, StoreReader as never)
    const firstStore = Nova.createStore(new TestStore(), { app, scope: 'scope-a' })
    const secondStore = Nova.createStore(new TestStore(), { app, scope: 'scope-b' })
    const firstSurface = app.createSurface('scope-a')
    const secondSurface = app.createSurface('scope-b')
    firstSurface.provide(TEST_STORE, firstStore)
    secondSurface.provide(TEST_STORE, secondStore)
    const firstNode = app.schema.createNode(firstSurface, {
      type: 'test.store-reader',
      id: 'scope-a-reader',
    }, { invalidate: false }) as StoreReader
    const secondNode = app.schema.createNode(secondSurface, {
      type: 'test.store-reader',
      id: 'scope-b-reader',
    }, { invalidate: false }) as StoreReader

    app.raph.run()
    firstStore.viewport.scale = 8
    app.raph.run()

    expect(firstNode.lastScale).toBe(8)
    expect(firstNode.renderCount).toBe(2)
    expect(secondNode.lastScale).toBe(1)
    expect(secondNode.renderCount).toBe(1)
  })

  it('освобождает автоматические observers Store вместе с узлом', () => {
    const app = createTestApp()
    Nova.registerComponents(app.schema, StoreReader as never)
    const store = Nova.createStore(new TestStore(), { app, scope: 'dispose-test' })
    const surface = app.createSurface('dispose')
    surface.provide(TEST_STORE, store)
    const node = app.schema.createNode(surface, {
      type: 'test.store-reader',
      id: 'dispose-reader',
    }, { invalidate: false }) as StoreReader

    app.raph.run()
    node.remove()
    store.viewport.scale = 9
    app.raph.run()

    expect(node.renderCount).toBe(1)
    expect(node.lastScale).toBe(1)
  })
})
