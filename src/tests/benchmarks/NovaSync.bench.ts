import { bench, describe } from 'vitest'
import {
  NovaSyncScope,
  createNovaSyncPort,
} from '@/index'

function createPort(value = 0) {
  const state = { value }
  return {
    state,
    port: createNovaSyncPort<number>({
      read() {
        return state.value
      },
      write(next) {
        state.value = next
      },
    }),
  }
}

describe('NovaSync benchmarks', () => {
  bench('1k one-to-one links immediate', () => {
    const scope = new NovaSyncScope()
    const nodes = Array.from({ length: 1000 }, (_, index) => {
      const source = createPort(index)
      const target = createPort(0)
      const nodeA = { componentId: `source-${index}` } as never
      const nodeB = { componentId: `target-${index}` } as never
      scope.registerNode(nodeA, { value: source.port })
      scope.registerNode(nodeB, { value: target.port })
      scope.link({ from: `source-${index}.value`, to: `target-${index}.value` })
      return source
    })

    for (let index = 0; index < nodes.length; index += 1) {
      scope.notify(`source-${index}.value`, index + 1)
    }
    scope.dispose()
  })

  bench('one source to 1k targets immediate', () => {
    const scope = new NovaSyncScope()
    const source = createPort(0)
    scope.registerNode({ componentId: 'source' } as never, { value: source.port })
    for (let index = 0; index < 1000; index += 1) {
      const target = createPort(0)
      scope.registerNode({ componentId: `target-${index}` } as never, { value: target.port })
      scope.link({ from: 'source.value', to: `target-${index}.value` })
    }

    scope.notify('source.value', 1)
    scope.dispose()
  })

  bench('frame-coalesced hot source updates', () => {
    const original = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(performance.now())
      return 1
    }) as typeof globalThis.requestAnimationFrame

    const scope = new NovaSyncScope()
    const source = createPort(0)
    const target = createPort(0)
    scope.registerNode({ componentId: 'source' } as never, { value: source.port })
    scope.registerNode({ componentId: 'target' } as never, { value: target.port })
    scope.link({ from: 'source.value', to: 'target.value', schedule: 'frame' })

    for (let index = 0; index < 1000; index += 1) {
      scope.notify('source.value', index)
    }

    scope.dispose()
    globalThis.requestAnimationFrame = original
  })

  bench('shared scope across app-prefixed port groups', () => {
    const scope = new NovaSyncScope()
    for (let index = 0; index < 500; index += 1) {
      const source = createPort(index)
      const target = createPort(0)
      scope.registerNode({ componentId: `app-a-source-${index}` } as never, { value: source.port })
      scope.registerNode({ componentId: `app-b-target-${index}` } as never, { value: target.port })
      scope.link({ from: `app-a-source-${index}.value`, to: `app-b-target-${index}.value` })
    }

    for (let index = 0; index < 500; index += 1) {
      scope.notify(`app-a-source-${index}.value`, index + 1)
    }
    scope.dispose()
  })
})
