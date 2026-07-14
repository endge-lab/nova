import { bench, describe } from 'vitest'
import { NovaHitIndex } from '@/model/runtime/interaction/NovaHitIndex'

interface BenchHitItem {
  id: number
  x: number
  y: number
  width: number
  height: number
  active: boolean
}

const benchOptions = {
  iterations: 10,
  warmupIterations: 2,
}

/**
 * Создает deterministic hit-test fixture.
 */
function createItems(count: number, clustered = false): Array<BenchHitItem> {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    x: clustered ? (index % 64) : (index % 500) * 12,
    y: clustered ? Math.floor(index % 64) : Math.floor(index / 500) * 12,
    width: clustered ? 96 : 8,
    height: clustered ? 96 : 8,
    active: true,
  }))
}

/**
 * Создает RBush-backed hit-test index для benchmarks.
 */
function createIndex(items: Array<BenchHitItem>): NovaHitIndex<BenchHitItem> {
  const index = new NovaHitIndex<BenchHitItem>({
    getBounds: item => ({ x: item.x, y: item.y, width: item.width, height: item.height }),
    isIndexable: item => item.active,
  })
  index.rebuild(items)
  return index
}

describe('Nova hit-test benchmarks', () => {
  bench('rbush rebuild: 50k interactive nodes', () => {
    createIndex(createItems(50_000))
  }, benchOptions)

  bench('rbush queryPoint: 10k queries over 50k nodes', () => {
    const index = createIndex(createItems(50_000))
    for (let step = 0; step < 10_000; step += 1) {
      index.queryPoint((step % 500) * 12 + 2, Math.floor(step / 500) * 12 + 2)
    }
  }, benchOptions)

  bench('rbush incremental update: 1k moving nodes', () => {
    const items = createItems(50_000)
    const index = createIndex(items)
    for (let step = 0; step < 1_000; step += 1) {
      items[step].x += 8_000
      index.update(items[step])
    }
  }, benchOptions)

  bench('rbush clustered worst-case query: 500 queries over 20k nodes', () => {
    const index = createIndex(createItems(20_000, true))
    for (let step = 0; step < 500; step += 1) {
      index.queryPoint(step % 64, step % 64)
    }
  }, benchOptions)
})
