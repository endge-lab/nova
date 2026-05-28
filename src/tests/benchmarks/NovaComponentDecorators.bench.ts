import { bench, describe } from 'vitest'
import {
  Command,
  Nova,
  NovaComponent,
  NovaComponentNode,
  Prop,
  Watch,
  type NovaApp,
} from '@/index'
import { createTestApp, installCanvasMocks } from '@/tests/helpers/novaTestHarness'

interface BenchProps {
  width: number
  height: number
  model: { version: number }
}

@NovaComponent({
  type: 'bench.decorated-node',
  dirtyPolicy: {
    update: ['model.version'],
    render: ['width', 'height'],
  },
})
class BenchDecoratedNode extends NovaComponentNode<BenchProps> {
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
  declare model: { version: number }

  count = 0

  /**
   * Считает version watcher вызовы.
   */
  @Watch('model.version', { phase: 'update' })
  syncVersion(): void {
    this.count += 1
  }

  /**
   * Считает command вызовы.
   */
  @Command('bench.decorated.tick')
  tick(): number {
    this.count += 1
    return this.count
  }
}

function createBenchApp(): NovaApp {
  installCanvasMocks()
  const app = createTestApp()
  Nova.registerComponents(app.schema, BenchDecoratedNode as never)
  return app
}

const DECORATOR_NODE_COUNT = 250
const DECORATOR_COMMAND_COUNT = 10_000
const DECORATOR_BENCH_OPTIONS = { time: 100, warmupTime: 10 }

describe('Nova component decorators benchmarks', () => {
  const dirtyApp = createBenchApp()
  const dirtySurface = dirtyApp.createSurface('bench-dirty')
  const dirtyNodes = Array.from({ length: DECORATOR_NODE_COUNT }, (_item, index) => dirtyApp.schema.createNode(dirtySurface, {
    type: 'bench.decorated-node',
    id: `dirty-node-${index}`,
    props: { model: { version: index } },
  }) as BenchDecoratedNode)

  const watcherApp = createBenchApp()
  const watcherSurface = watcherApp.createSurface('bench-watchers')
  const watcherNodes = Array.from({ length: DECORATOR_NODE_COUNT }, (_item, index) => watcherApp.schema.createNode(watcherSurface, {
    type: 'bench.decorated-node',
    id: `watcher-node-${index}`,
    props: { model: { version: index } },
  }) as BenchDecoratedNode)

  const commandApp = createBenchApp()
  const commandSurface = commandApp.createSurface('bench-commands')
  const commandNode = commandApp.schema.createNode(commandSurface, {
    type: 'bench.decorated-node',
    id: 'command-node',
    props: { model: { version: 1 } },
  }) as BenchDecoratedNode

  bench('decorated component creation: 250 nodes', () => {
    const app = createBenchApp()
    const surface = app.createSurface('bench-create')
    for (let index = 0; index < DECORATOR_NODE_COUNT; index += 1) {
      app.schema.createNode(surface, {
        type: 'bench.decorated-node',
        id: `node-${index}`,
        props: { model: { version: index } },
      })
    }
    app.destroy()
  }, DECORATOR_BENCH_OPTIONS)

  bench('path dirty policy setProps: 250 components', () => {
    for (let index = 0; index < dirtyNodes.length; index += 1) {
      dirtyNodes[index].setProps({ model: { version: dirtyNodes[index].model.version + 1 } })
    }
  }, DECORATOR_BENCH_OPTIONS)

  bench('watcher dispatch: 250 update phase calls', () => {
    for (let index = 0; index < watcherNodes.length; index += 1) {
      watcherNodes[index].setProps({ model: { version: watcherNodes[index].model.version + 1 } })
      watcherNodes[index].update()
    }
  }, DECORATOR_BENCH_OPTIONS)

  bench('command bus targeted run: 10k calls', () => {
    for (let index = 0; index < DECORATOR_COMMAND_COUNT; index += 1) {
      commandApp.commands.run('bench.decorated.tick', undefined, { target: commandNode })
    }
  }, DECORATOR_BENCH_OPTIONS)
})
