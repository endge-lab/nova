import { bench, describe } from 'vitest'
import {
  Nova,
  NovaComponent,
  NovaComponentNode,
  Reactive,
  Store,
} from '@/index'
import { createTestApp, installCanvasMocks } from '@/tests/helpers/novaTestHarness'

@Store()
class BenchViewportStore {
  @Reactive({ phase: 'render' })
  scale = 1

  @Reactive({ phase: 'render' })
  x = 0
}

@Store()
class BenchStore {
  @Reactive()
  viewport = new BenchViewportStore()
}

const BENCH_STORE = Nova.createContextToken<BenchStore>('BenchStore')

@NovaComponent({ type: 'bench.store-reader' })
class BenchStoreReader extends NovaComponentNode {
  value = 0

  override render(): void {
    const store = this.inject(BENCH_STORE)
    this.value = store.viewport.scale
  }
}

function createBenchFixture(count: number) {
  installCanvasMocks()
  const app = createTestApp({ width: 640, height: 420 })
  Nova.registerComponents(app.schema, BenchStoreReader as never)
  const store = Nova.createStore(new BenchStore(), { app, scope: `bench-store-${count}` })
  const surface = app.createSurface(`bench-store-${count}`)
  surface.provide(BENCH_STORE, store)
  for (let index = 0; index < count; index += 1) {
    app.schema.createNode(surface, {
      type: 'bench.store-reader',
      id: `reader-${index}`,
    })
  }
  app.raph.run()
  return { app, store }
}

const STORE_BENCH_OPTIONS = { time: 100, warmupTime: 10 }

describe('Nova store decorators benchmarks', () => {
  bench('reactive store notify: 1k render subscribers', () => {
    const { app, store } = createBenchFixture(1_000)
    store.viewport.scale += 1
    app.raph.run()
    app.destroy()
  }, STORE_BENCH_OPTIONS)

  bench('reactive store batched viewport writes: 1k subscribers', () => {
    const { app, store } = createBenchFixture(1_000)
    Nova.batchStore(store, () => {
      store.viewport.scale += 1
      store.viewport.scale += 1
      store.viewport.x += 1
    })
    app.raph.run()
    app.destroy()
  }, STORE_BENCH_OPTIONS)

  bench('reactive store creation: 10k instances', () => {
    const app = createTestApp()
    for (let index = 0; index < 10_000; index += 1) {
      Nova.createStore(new BenchStore(), { app, scope: `bench-create-${index}` })
    }
    app.destroy()
  }, STORE_BENCH_OPTIONS)
})
