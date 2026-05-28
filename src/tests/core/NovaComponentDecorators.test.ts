import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Api,
  Command,
  Nova,
  NovaComponent,
  NovaComponentNode,
  Prop,
  Watch,
  type NovaApp,
  type NovaComponentDescriptor,
  type NovaSurface,
} from '@/index'
import { createTestApp, installCanvasMocks } from '@/tests/helpers/novaTestHarness'

interface DecoratedProps {
  width: number
  height: number
  model: { version: number; label?: string }
}

interface DecoratedApi {
  readLabel: () => string
}

@NovaComponent({
  type: 'test.decorated-counter',
  dirtyPolicy: {
    update: ['model.version'],
    render: ['width', 'height'],
  },
})
class DecoratedCounterNode extends NovaComponentNode<DecoratedProps, DecoratedApi> {
  @Prop.number({ default: 100 })
  override get width(): number {
    return this.getProps().width
  }

  override set width(value: number) {
    this.setProps({ width: value })
  }

  @Prop.number({ default: 40 })
  override get height(): number {
    return this.getProps().height
  }

  override set height(value: number) {
    this.setProps({ height: value })
  }

  @Prop.model({ required: true })
  declare model: { version: number; label?: string }

  readonly watcherCalls: Array<{ next: unknown; prev: unknown; path: string }> = []

  /**
   * Записывает изменения модели.
   */
  @Watch('model.version', { phase: 'update', immediate: true })
  syncModel(next: unknown, prev: unknown, payload: { path: string }): void {
    this.watcherCalls.push({ next, prev, path: payload.path })
  }

  /**
   * Возвращает label модели.
   */
  @Api()
  readLabel(): string {
    return this.model.label ?? ''
  }

  /**
   * Меняет label модели через command bus.
   */
  @Command('test.decorated.rename')
  rename(label: string): string {
    this.setProps({ model: { ...this.model, version: this.model.version + 1, label } })
    return label
  }
}

function createDecoratedFixture(): {
  app: NovaApp
  surface: NovaSurface
  node: DecoratedCounterNode
  descriptor: NovaComponentDescriptor
} {
  const app = createTestApp()
  const surface = app.createSurface('decorators')
  Nova.registerComponents(app.schema, DecoratedCounterNode as never)
  const descriptor = app.schema.resolve('test.decorated-counter')!
  const node = app.schema.createNode(surface, {
    type: 'test.decorated-counter',
    id: 'counter',
    props: { model: { version: 1, label: 'Initial' } },
  }) as DecoratedCounterNode
  return { app, surface, node, descriptor }
}

beforeEach(() => {
  installCanvasMocks()
})

describe('Nova component decorators', () => {
  it('generates descriptor metadata, defaults and size bounds', () => {
    const { app, descriptor } = createDecoratedFixture()

    expect(descriptor.fields).toMatchObject({
      width: { type: 'number' },
      height: { type: 'number' },
      model: { type: 'record', required: true },
    })
    expect(descriptor.normalize?.({ type: 'test.decorated-counter', props: { model: { version: 2 } } })).toMatchObject({
      width: 100,
      height: 40,
      model: { version: 2 },
    })
    expect(descriptor.measureBounds?.({ registry: app.schema, depth: 0 }, {
      type: 'test.decorated-counter',
      props: { model: { version: 2 }, width: 240, height: 80 },
    })).toEqual({ x: 0, y: 0, width: 240, height: 80 })
  })

  it('runs immediate and phase watchers for versioned paths', () => {
    const { node } = createDecoratedFixture()

    expect(node.watcherCalls).toEqual([{ next: 1, prev: undefined, path: 'model.version' }])
    node.setProps({ model: { version: 2, label: 'Next' } })
    node.update()

    expect(node.watcherCalls.at(-1)).toEqual({ next: 2, prev: 1, path: 'model.version' })
  })

  it('routes dirty policy paths and public API through decorated metadata', () => {
    const { app, node } = createDecoratedFixture()
    const dirty = vi.spyOn(node, 'dirty')

    node.setProps({ model: { version: 2, label: 'Updated' } })

    expect(dirty).toHaveBeenCalledWith({ matrix: false, update: true, render: true })
    expect(app.components.requireApi<DecoratedApi>('counter').readLabel()).toBe('Updated')
  })

  it('registers commands on mount, disposes them and requires target when ambiguous', () => {
    const { app, surface, node } = createDecoratedFixture()
    const second = app.schema.createNode(surface, {
      type: 'test.decorated-counter',
      id: 'counter-second',
      props: { model: { version: 1 } },
    }) as DecoratedCounterNode

    expect(() => app.commands.run('test.decorated.rename', 'Broken')).toThrow(/target or scope/)
    expect(app.commands.run('test.decorated.rename', 'Renamed', { target: node })).toBe('Renamed')
    expect(node.getProps().model.label).toBe('Renamed')

    second.remove()
    expect(app.commands.count('test.decorated.rename')).toBe(1)
  })
})
