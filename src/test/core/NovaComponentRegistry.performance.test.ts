import { describe, expect, it } from 'vitest'
import { Nova, NovaNode, NovaSchemaRegistry } from '@/index'

type TestEvents = Record<string, any>

describe('Nova defined component registry performance', () => {
  it('registers and resolves 10k global tags under budget', () => {
    const registry = new NovaSchemaRegistry()
    const components = Array.from({ length: 10_000 }, (_item, index) => Nova.defineComponent(
      /**
       * Описывает Nova-node PerfComponentNode и его runtime-поведение.
       */
      class PerfComponentNode extends NovaNode<TestEvents> {
        /**
         * Выполняет отрисовку PerfComponentNode.
         */
        render(): void {}
      },
      { tag: `PerfComponent${index}` },
    ))

    const startedAt = performance.now()
    Nova.registerComponents(registry, components)
    const registerMs = performance.now() - startedAt

    const lookupStartedAt = performance.now()
    let missing = 0
    for (let index = 0; index < components.length; index += 1) {
      if (!registry.resolve(`PerfComponent${index}`)) {
        missing += 1
      }
    }
    const lookupMs = performance.now() - lookupStartedAt

    expect(missing).toBe(0)
    expect(registerMs).toBeLessThan(250)
    expect(lookupMs).toBeLessThan(80)
  })
})
