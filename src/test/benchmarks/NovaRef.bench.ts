import { bench, describe } from 'vitest'
import { bindNovaRef, Nova, unbindNovaRef } from '@/index'

interface CounterApi {
  value: number
  increment: (delta: number) => number
}

function createApi(): CounterApi {
  return {
    value: 0,
    /**
     * Выполняет действие increment в рамках ответственности текущего класса.
     */
    increment(delta: number): number {
      this.value += delta
      return this.value
    },
  }
}

describe('бенчмарки proxy ref Nova', () => {
  bench('direct API method call', () => {
    const api = createApi()
    for (let index = 0; index < 10_000; index += 1) {
      api.increment(1)
    }
  })

  bench('mounted proxy ref method call', () => {
    const api = createApi()
    const ref = Nova.ref<CounterApi>('bench')
    bindNovaRef(ref, api)

    for (let index = 0; index < 10_000; index += 1) {
      ref.increment(1)
    }
  })

  bench('1k ref bind and unbind', () => {
    for (let index = 0; index < 1_000; index += 1) {
      const api = createApi()
      const ref = Nova.ref<CounterApi>(`bench-${index}`)
      bindNovaRef(ref, api)
      unbindNovaRef(ref, api)
    }
  })
})
