import { bench, describe, vi } from 'vitest'
import { Nova, NovaNode, type NovaApp, type NovaSurface } from '@/index'
import { createTestApp, installCanvasMocks } from '@/test/helpers/novaTestHarness'

class ReactiveBenchNode extends NovaNode<any> {
  value = 0

  read(value: number): void {
    this.value = value
  }

  override render(): void {}
}

const benchOptions = {
  iterations: 3,
  warmupIterations: 1,
  time: 10,
  warmupTime: 5,
}

installCanvasMocks()

describe('Nova reactive signal benchmarks', () => {
  bench('signal update with one subscriber', () => {
    const signal = Nova.signal(0)
    const node = createBenchNode()

    Nova.trackNode(node, () => node.read(signal.value))

    for (let index = 0; index < 10_000; index += 1) {
      signal.value = index
    }
  }, benchOptions)

  bench('direct dirty with one subscriber baseline', () => {
    const node = createBenchNode()
    const invalidate = vi.spyOn(node.nova, 'invalidate').mockImplementation(() => undefined)

    for (let index = 0; index < 10_000; index += 1) {
      node.dirty({ update: true, render: true })
      node.nova.invalidate()
    }

    invalidate.mockRestore()
  }, benchOptions)

  bench('signal update with 1k subscribers', () => {
    const signal = Nova.signal(0)
    const nodes = Array.from({ length: 1_000 }, () => createBenchNode())

    for (const node of nodes) {
      Nova.trackNode(node, () => node.read(signal.value))
    }

    for (let index = 0; index < 100; index += 1) {
      signal.value = index
    }
  }, benchOptions)

  bench('computed chain stays lazy before value read', () => {
    const source = Nova.signal(1)
    const first = Nova.computed(() => source.value + 1)
    const second = Nova.computed(() => first.value + 1)

    for (let index = 0; index < 10_000; index += 1) {
      source.value = index
    }

    if (second.value < 0) {
      throw new Error('Unexpected computed value')
    }
  }, benchOptions)
})

function createBenchNode(): ReactiveBenchNode {
  const app: NovaApp = createTestApp()
  const surface: NovaSurface<any> = app.createSurface('reactivity-bench')
  const node = new ReactiveBenchNode(app, surface)
  surface.addChild(node, { invalidate: false })
  vi.spyOn(app, 'invalidate').mockImplementation(() => undefined)
  return node
}
