import type { EventList } from '@endge/utils'
import type { NovaApp } from '@/index'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,

  NovaContainer,
  NovaHitIndex,
  NovaNode,
  NovaScene,
  NovaSpatialIndex,
  NovaSupportedNativeEvents,
  NovaSurface,
  RaphSchedulerType,
  RendererType,
} from '@/index'

type TestEvents = EventList

interface AuditLog {
  renders: Array<string>
  updates: Array<string>
  surfaceFlushes: Array<string>
  surfaceRenders: Array<string>
}

function createAuditLog(): AuditLog {
  return {
    renders: [],
    updates: [],
    surfaceFlushes: [],
    surfaceRenders: [],
  }
}

function clearAuditLog(log: AuditLog): void {
  log.renders.length = 0
  log.updates.length = 0
  log.surfaceFlushes.length = 0
  log.surfaceRenders.length = 0
}

function create2DContextStub(): CanvasRenderingContext2D {
  const state: Record<PropertyKey, any> = {
    fillStyle: '#000000',
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    createPattern: vi.fn(() => ({})),
  }

  return new Proxy(state, {
    /**
     * Возвращает значение состояния текущего класса.
     */
    get(target, prop) {
      if (!(prop in target)) {
        target[prop] = vi.fn()
      }
      return target[prop]
    },
    /**
     * Обновляет значение состояния текущего класса.
     */
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  }) as CanvasRenderingContext2D
}

function installCanvasMocks(): void {
  Object.defineProperty(window, 'devicePixelRatio', {
    value: 2,
    configurable: true,
  })

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type === RendererType.Web2D) {
      return create2DContextStub()
    }

    return null
  })

  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width = Number.parseFloat(this.style.width) || this.width || 0
    const height = Number.parseFloat(this.style.height) || this.height || 0

    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect
  })
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return canvas
}

function createApp(options: { width?: number, height?: number, input?: boolean, pointerCapture?: boolean } = {}): NovaApp<TestEvents> {
  return Nova.createApp<TestEvents>({
    target: createCanvas(),
    size: {
      width: options.width ?? 800,
      height: options.height ?? 480,
      maxDpr: 2,
    },
    input: {
      pointer: { enabled: options.input ?? false, capture: options.pointerCapture ?? true },
      keyboard: { enabled: options.input ?? false, scope: 'manual' },
    },
    renderer: {
      main: RendererType.Web2D,
    },
    scheduler: {
      type: RaphSchedulerType.Sync,
      loop: false,
    },
  })
}

/**
 * Описывает Nova-node AuditNode и его runtime-поведение.
 */
class AuditNode extends NovaNode<TestEvents> {
  renderCount = 0
  updateCount = 0

  /**
   * Создает экземпляр AuditNode и подготавливает базовое состояние.
   */
  constructor(
    app: NovaApp<TestEvents>,
    surface: NovaSurface<TestEvents>,
    private readonly _name: string,
    private readonly _log: AuditLog,
  ) {
    super(app, surface)
  }

  /**
   * Выполняет отрисовку AuditNode.
   */
  override render(): void {
    this.renderCount += 1
    this._log.renders.push(this._name)
  }

  /**
   * Обновляет runtime-состояние AuditNode.
   */
  override update(): void {
    this.updateCount += 1
    this._log.updates.push(this._name)
  }
}

/**
 * Описывает surface AuditSurface и его роль в render pipeline.
 */
class AuditSurface extends NovaSurface<TestEvents> {
  private _auditLog?: AuditLog

  /**
   * Создает экземпляр AuditSurface и подготавливает базовое состояние.
   */
  constructor(
    name: string,
    app: NovaApp<TestEvents>,
    log: AuditLog,
  ) {
    super(name, app)
    this._auditLog = log
  }

  /**
   * Выполняет действие doRender в рамках ответственности AuditSurface.
   */
  override doRender(): void {
    this._auditLog?.surfaceRenders.push(this.name)
    this.compileRenderFrame()
  }

  /**
   * Компилирует runtime-представление AuditSurface.
   */
  override compileRenderFrame() {
    this._auditLog?.surfaceFlushes.push(this.name)
    return super.compileRenderFrame()
  }

  /**
   * Принудительно завершает накопленные изменения AuditSurface.
   */
  flush(_mainCtx: CanvasRenderingContext2D): void {
    this._auditLog?.surfaceFlushes.push(this.name)
  }
}

/**
 * Описывает Nova-node LifecycleAuditNode и его runtime-поведение.
 */
class LifecycleAuditNode extends AuditNode {
  mountedCount = 0
  unmountedCount = 0
  pausedCount = 0
  resumedCount = 0

  /**
   * Обрабатывает входящее событие LifecycleAuditNode.
   */
  override onMount(): void {
    this.mountedCount += 1
  }

  /**
   * Обрабатывает входящее событие LifecycleAuditNode.
   */
  override onUnmount(): void {
    this.unmountedCount += 1
  }

  /**
   * Обрабатывает входящее событие LifecycleAuditNode.
   */
  override onPause(): void {
    this.pausedCount += 1
  }

  /**
   * Обрабатывает входящее событие LifecycleAuditNode.
   */
  override onResume(): void {
    this.resumedCount += 1
  }
}

function measure(label: string, run: () => void): number {
  const startedAt = performance.now()
  run()
  const elapsedMs = performance.now() - startedAt
  console.info(`[NovaCorePerf] ${label}: ${elapsedMs.toFixed(2)} ms`)
  return elapsedMs
}

function dispatchMouse(canvas: HTMLCanvasElement, type: string, x: number, y: number): void {
  canvas.dispatchEvent(new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
  }))
}

function dispatchPointer(canvas: HTMLCanvasElement, type: string, x: number, y: number, pointerId: number): MouseEvent {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
  })
  Object.defineProperty(event, 'pointerId', {
    value: pointerId,
    configurable: true,
  })
  canvas.dispatchEvent(event)
  return event
}

function waitFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

describe('проверка Smoke-проверка поведения и производительности ядра Nova', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('отрисовывает прямых детей поверхности по zIndex, сохраняя zIndex как вес', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)

    const first = surface.createNode(AuditNode, 'first-inserted-z100', log)
    first.options({ width: 10, height: 10, zIndex: 100 })
    const second = surface.createNode(AuditNode, 'second-inserted-z0', log)
    second.options({ width: 10, height: 10, zIndex: 0 })

    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    surface.doRender()

    expect(first.weight).toBe(100)
    expect(second.weight).toBe(0)
    expect(log.renders).toEqual(['second-inserted-z0', 'first-inserted-z100'])

    app.destroy()
  })

  it('сохраняет порядок добавления прямых детей поверхности при одинаковом zIndex', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)

    surface.createNode(AuditNode, 'first-z10', log).options({ width: 10, height: 10, zIndex: 10 })
    surface.createNode(AuditNode, 'second-z10', log).options({ width: 10, height: 10, zIndex: 10 })
    surface.createNode(AuditNode, 'third-z10', log).options({ width: 10, height: 10, zIndex: 10 })

    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['first-z10', 'second-z10', 'third-z10'])

    app.destroy()
  })

  it('выводит поверхности по zIndex, сохраняя zIndex как вес', () => {
    const log = createAuditLog()
    const app = createApp()

    app.createSurface('inserted-first-z100', AuditSurface, log).options({ zIndex: 100 })
    app.createSurface('inserted-second-z0', AuditSurface, log).options({ zIndex: 0 })

    clearAuditLog(log)
    app.flush()

    expect(log.surfaceFlushes).toEqual(['inserted-second-z0', 'inserted-first-z100'])

    app.destroy()
  })

  it('очищает принадлежащий приложению корневой canvas без композитинга каждой поверхности', () => {
    const log = createAuditLog()
    const app = createApp({ width: 100, height: 80 })
    app.createSurface('scene', AuditSurface, log)
    const ctx = app.canvas.getContext2D()

    app.flush()

    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 200, 160)
    expect(ctx.scale).toHaveBeenCalledWith(2, 2)
    expect(ctx.drawImage).not.toHaveBeenCalled()

    app.destroy()
  })

  it('сохраняет порядок добавления поверхностей при одинаковом zIndex', () => {
    const log = createAuditLog()
    const app = createApp()

    app.createSurface('first-z10', AuditSurface, log).options({ zIndex: 10 })
    app.createSurface('second-z10', AuditSurface, log).options({ zIndex: 10 })
    app.createSurface('third-z10', AuditSurface, log).options({ zIndex: 10 })

    clearAuditLog(log)
    app.flush()

    expect(log.surfaceFlushes).toEqual(['first-z10', 'second-z10', 'third-z10'])

    app.destroy()
  })

  it('отрисовывает вложенных потомков при перерисовке уровня поверхности', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)

    const group = surface.createNode(AuditNode, 'group', log)
    group.options({ width: 100, height: 100 })
    const child = new AuditNode(app, surface, 'nested-child', log)
    child.options({ width: 10, height: 10 })
    group.addChild(child)

    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['group', 'nested-child'])

    app.destroy()
  })

  it('помечает всю поверхность для перерисовки, когда прямой дочерний узел получает render-dirty', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const nodes = Array.from({ length: 30 }, (_, index) => {
      const node = surface.createNode(AuditNode, `node-${index}`, log)
      node.options({ x: index, y: index, width: 5, height: 5 })
      return node
    })

    clearAuditLog(log)
    nodes[0].dirty({ render: true })

    expect(log.renders).toHaveLength(nodes.length)
    expect(log.renders[0]).toBe('node-0')
    expect(log.renders.at(-1)).toBe('node-29')

    app.destroy()
  })

  it('вычисляет active из локального active и восстанавливает наследуемое значение при повторной активации родителя', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const group = surface.createNode(AuditNode, 'group', log)
    const child = new AuditNode(app, surface, 'child', log)
    group.addChild(child)

    expect(group.active).toBe(true)
    expect(child.active).toBe(true)

    group.active = false
    expect(group.active).toBe(false)
    expect(child.active).toBe(false)

    group.active = true
    expect(group.active).toBe(true)
    expect(child.active).toBe(true)

    child.active = false
    expect(child.localActive).toBe(false)
    expect(child.active).toBe(false)

    group.active = false
    expect(child.active).toBe(false)

    group.active = true
    expect(group.active).toBe(true)
    expect(child.active).toBe(false)

    app.destroy()
  })

  it('сохраняет visible только для render, а active только для update в lifecycle узла', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const node = surface.createNode(AuditNode, 'node', log)
    node.options({ width: 10, height: 10 })

    node.active = false
    node.visible = true
    clearAuditLog(log)
    node.dirty({ update: true, render: true })

    expect(log.updates).toEqual([])
    expect(log.renders).toEqual(['node'])

    node.active = true
    node.visible = false
    clearAuditLog(log)
    node.dirty({ update: true, render: true })

    expect(log.updates).toEqual(['node'])
    expect(log.renders).toEqual([])

    app.destroy()
  })

  it('вычисляет visible из локального значения и унаследованной видимости родителя', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const group = surface.createNode(AuditNode, 'group', log)
    const child = new AuditNode(app, surface, 'child', log)
    group.addChild(child)

    group.visible = false
    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    surface.doRender()

    expect(group.visible).toBe(false)
    expect(child.localVisible).toBe(true)
    expect(child.visible).toBe(false)
    expect(log.renders).toEqual([])

    group.visible = true
    child.visible = false
    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['group'])
    expect(child.localVisible).toBe(false)
    expect(child.visible).toBe(false)

    child.visible = true
    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['group', 'child'])

    app.destroy()
  })

  it('использует API NovaContainer для добавления, удаления, очистки и массового переключения детей', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const container = surface.createNode(NovaContainer<TestEvents>)
    const first = new AuditNode(app, surface, 'first', log)
    const second = new AuditNode(app, surface, 'second', log)
    const third = new AuditNode(app, surface, 'third', log)

    second.on('mousedown', vi.fn())
    container.add(first)
    container.add(second)
    container.add(third)

    expect(container.childCount).toBe(3)
    expect(container.novaChildren).toEqual([first, second, third])
    expect(app.events.interactiveNodes.has(second)).toBe(true)

    container.setChildrenVisible(false)
    expect(first.localVisible).toBe(false)
    expect(second.localVisible).toBe(false)
    expect(third.localVisible).toBe(false)

    container.setChildrenVisible(true)
    container.setChildrenActive(false)
    expect(container.novaChildren.every(child => child.localActive === false)).toBe(true)

    expect(container.remove(second)).toBe(true)
    expect(container.childCount).toBe(2)
    expect(container.novaChildren).toEqual([first, third])
    expect(app.events.interactiveNodes.has(second)).toBe(false)
    expect(container.remove(second)).toBe(false)

    container.clear()
    expect(container.childCount).toBe(0)
    expect(container.novaChildren).toEqual([])

    app.destroy()
  })

  it('вычисляет локальные, мировые границы и границы контейнера', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const node = surface.createNode(AuditNode, 'node', log)
    node.options({ x: 12, y: 18, width: 40, height: 20 })

    expect(node.getLocalBounds()).toEqual({ x: 0, y: 0, width: 40, height: 20 })
    expect(node.getWorldBounds()).toEqual({ x: 12, y: 18, width: 40, height: 20 })

    const group = surface.createNode(NovaContainer<TestEvents>)
    group.add(new AuditNode(app, surface, 'left', log).options({ x: 10, y: 8, width: 20, height: 16 }))
    group.add(new AuditNode(app, surface, 'right', log).options({ x: 36, y: 20, width: 10, height: 12 }))

    expect(group.getLocalBounds()).toEqual({ x: 10, y: 8, width: 36, height: 24 })

    app.destroy()
  })

  it('вычисляет точные границы render по элементам схемы', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const node = surface.createNode(AuditNode, 'schema-node', log)

    node.options({ x: 20, y: 30, width: 1, height: 1 })
    node.setRenderBoundsFromSchema([
      { type: 'line', x1: 10, y1: 12, x2: 70, y2: 12, styles: { width: 4 } },
      { type: 'circle', x: 120, y: 40, radius: 10 },
      { type: 'arc', x: 250, y: 32, radius: 12, startAngle: 0, endAngle: Math.PI, styles: { width: 6 } },
      { type: 'text', text: 'label', x: 150, y: 8, width: 80, height: 18 },
    ])
    node.on('mousedown', vi.fn())

    expect(node.getLocalRenderBounds()).toEqual({ x: 8, y: 8, width: 257, height: 42 })
    expect(node.getRenderBounds()).toEqual({ x: 28, y: 38, width: 257, height: 42 })
    expect(node.containsPoint(34, 42)).toBe(true)
    expect(node.containsPoint(23, 33)).toBe(false)

    app.events.hitTestMode = 'spatial'
    expect(app.events.hitTest(190, 48)).toBe(node)

    app.destroy()
  })

  it('использует иерархию transform для hit-test и преобразования координат', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const group = surface.createNode(AuditNode, 'group', log)
    const child = new AuditNode(app, surface, 'child', log)

    group.options({ x: 100, y: 50 })
    child.options({ x: 20, y: 10, width: 30, height: 15 })
    group.addChild(child)

    expect(child.containsPoint(120, 60)).toBe(true)
    expect(child.containsPoint(150, 75)).toBe(true)
    expect(child.containsPoint(151, 75)).toBe(false)
    expect(child.toLocal(125, 65)).toEqual([5, 5])

    app.destroy()
  })

  it('уточняет hit-test границ пользовательскими handlers формы', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const bottom = surface.createNode(AuditNode, 'bottom', log)
    const top = surface.createNode(AuditNode, 'top', log)

    bottom.options({ x: 10, y: 10, width: 80, height: 80, zIndex: 1 })
    top.options({
      x: 10,
      y: 10,
      width: 80,
      height: 80,
      zIndex: 2,
      hitTest: ({ localX, localY }) => {
        const dx = localX - 40
        const dy = localY - 40
        return dx * dx + dy * dy <= 20 * 20
      },
    })
    bottom.on('mousedown', vi.fn())
    top.on('mousedown', vi.fn())

    expect(top.containsPoint(50, 50)).toBe(true)
    expect(top.containsPoint(15, 15)).toBe(false)

    app.events.hitTestMode = 'linear'
    expect(app.events.hitTest(50, 50)).toBe(top)
    expect(app.events.hitTest(15, 15)).toBe(bottom)

    app.events.hitTestMode = 'spatial'
    expect(app.events.hitTest(50, 50)).toBe(top)
    expect(app.events.hitTest(15, 15)).toBe(bottom)

    top.setHitTest(({ localX, localY }) => localX >= 0 && localY >= 0 && localX <= 80 && localY <= 80)
    expect(app.events.hitTest(15, 15)).toBe(top)

    app.destroy()
  })

  it('отсекает узлы за границами поверхности при включённом bounds culling', () => {
    const log = createAuditLog()
    const app = createApp({ width: 320, height: 180 })
    const surface = app.createSurface('scene', AuditSurface, log)
    surface.renderCullingMode = 'bounds'

    surface.createNode(AuditNode, 'visible', log).options({ x: 20, y: 20, width: 40, height: 30 })
    surface.createNode(AuditNode, 'outside', log).options({ x: 600, y: 20, width: 40, height: 30 })

    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['visible'])
    expect(surface.renderCullingStats.testedNodes).toBe(2)
    expect(surface.renderCullingStats.culledNodes).toBe(1)

    app.destroy()
  })

  it('сохраняет возможность render корня отсечения, если он предоставляет границы viewport до появления детей', () => {
    const log = createAuditLog()
    const app = createApp({ width: 320, height: 180 })
    const surface = app.createSurface('scene', AuditSurface, log)
    surface.renderCullingMode = 'bounds'

    /**
     * Описывает Nova-node ViewportRootNode и его runtime-поведение.
     */
    class ViewportRootNode extends NovaContainer<TestEvents> {
      /**
       * Выполняет отрисовку ViewportRootNode.
       */
      override render(): void {
        if (this.childCount > 0) {
          return
        }

        const child = new AuditNode(this.nova, this.surface, 'late-child', log)
        child.options({ x: 20, y: 20, width: 40, height: 30 })
        this.add(child)
      }

      /**
       * Возвращает значение состояния ViewportRootNode.
       */
      override getRenderBounds(): { x: number, y: number, width: number, height: number } {
        return { x: 0, y: 0, width: this.nova.width, height: this.nova.height }
      }
    }

    surface.createNode(ViewportRootNode).options({ width: 320, height: 180 })

    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    surface.doRender()

    expect(log.renders).toContain('late-child')
    expect(surface.renderCullingStats.culledNodes).toBe(0)

    app.destroy()
  })

  it('отсекает пустой контейнер до создания детей без явных границ render', () => {
    const log = createAuditLog()
    const app = createApp({ width: 320, height: 180 })
    const surface = app.createSurface('scene', AuditSurface, log)
    surface.renderCullingMode = 'bounds'

    /**
     * Описывает Nova-node EmptyBoundsContainerNode и его runtime-поведение.
     */
    class EmptyBoundsContainerNode extends NovaContainer<TestEvents> {
      /**
       * Выполняет отрисовку EmptyBoundsContainerNode.
       */
      override render(): void {
        const child = new AuditNode(this.nova, this.surface, 'late-child', log)
        child.options({ x: 20, y: 20, width: 40, height: 30 })
        this.add(child)
      }
    }

    surface.createNode(EmptyBoundsContainerNode)

    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    surface.doRender()

    expect(log.renders).toEqual([])
    expect(surface.renderCullingStats.culledNodes).toBe(1)

    app.destroy()
  })

  it('возвращает верхний визуальный узел при пересекающемся hit-test', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const bottom = surface.createNode(AuditNode, 'bottom', log)
    const top = surface.createNode(AuditNode, 'top', log)

    bottom.options({ x: 20, y: 20, width: 120, height: 80, zIndex: 0 })
    top.options({ x: 40, y: 40, width: 120, height: 80, zIndex: 100 })
    bottom.on('mousedown', vi.fn())
    top.on('mousedown', vi.fn())

    expect(app.events.hitTest(60, 60)).toBe(top)
    expect(app.events.hitTest(24, 24)).toBe(bottom)

    app.destroy()
  })

  it('использует метки порядка render для hit-test прямых соседей с одинаковым z-index', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const first = surface.createNode(AuditNode, 'first', log)
    const second = surface.createNode(AuditNode, 'second', log)

    first.options({ x: 20, y: 20, width: 120, height: 80, zIndex: 10 })
    second.options({ x: 20, y: 20, width: 120, height: 80, zIndex: 10 })
    first.on('mousedown', vi.fn())
    second.on('mousedown', vi.fn())

    expect(app.compareRenderOrder(first, second)).toBeLessThan(0)
    expect(app.getRenderOrderStamp(second).at(-1)).toBeGreaterThan(app.getRenderOrderStamp(first).at(-1)!)
    expect(app.events.hitTest(60, 60)).toBe(second)

    app.destroy()
  })

  it('выполняет hit-test узла по пользовательским границам render, когда локальные границы служат только placeholder', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)

    /**
     * Описывает Nova-node RenderBoundsHitNode и его runtime-поведение.
     */
    class RenderBoundsHitNode extends AuditNode {
      /**
       * Возвращает значение состояния RenderBoundsHitNode.
       */
      override getRenderBounds(): { x: number, y: number, width: number, height: number } {
        return { x: 120, y: 80, width: 180, height: 40 }
      }

      /**
       * Выполняет действие containsPoint в рамках ответственности RenderBoundsHitNode.
       */
      override containsPoint(x: number, y: number): boolean {
        const bounds = this.getRenderBounds()

        return (
          x >= bounds.x
          && x <= bounds.x + bounds.width
          && y >= bounds.y
          && y <= bounds.y + bounds.height
        )
      }
    }

    const node = surface.createNode(RenderBoundsHitNode, 'task-like-node', log)
    node.options({ x: 0, y: 0, width: 1, height: 1 })
    node.on('mousedown', vi.fn())

    expect(app.events.hitTest(140, 90)).toBe(node)
    expect(app.events.hitTest(40, 30)).toBeNull()

    app.destroy()
  })

  it('инкрементально обновляет пространственный индекс при перемещении или удалении одного узла', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const node = surface.createNode(AuditNode, 'moving', log)

    app.events.hitTestMode = 'spatial'
    node.options({ x: 10, y: 10, width: 30, height: 30 })
    node.on('mousedown', vi.fn())

    expect(app.events.hitTest(20, 20)).toBe(node)

    node.options({ x: 200, y: 10 })

    expect(app.events.hitTest(20, 20)).toBeNull()
    expect(app.events.hitTest(210, 20)).toBe(node)

    node.remove()

    expect(app.events.hitTest(210, 20)).toBeNull()

    app.destroy()
  })

  it('отправляет pointer-события через фазы capture, target и bubble', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const order: Array<string> = []
    const group = surface.createNode(AuditNode, 'group', log)
    const child = new AuditNode(app, surface, 'child', log)

    group.options({ x: 20, y: 20, width: 160, height: 120 })
    child.options({ x: 20, y: 20, width: 60, height: 40 })
    group.addChild(child)
    group.onCapture('mousedown', () => order.push('capture-group'))
    group.on('mousedown', () => order.push('bubble-group'))
    child.on('mousedown', () => order.push('target-child'))
    app.flush()

    app.handleEvent('mousedown', new MouseEvent('mousedown', { clientX: 50, clientY: 50, button: 0 }))

    expect(order).toEqual(['capture-group', 'target-child', 'bubble-group'])

    app.destroy()
  })

  it('останавливает всплытие pointer-события, когда target отменяет распространение', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const order: Array<string> = []
    const group = surface.createNode(AuditNode, 'group', log)
    const child = new AuditNode(app, surface, 'child', log)

    group.options({ x: 20, y: 20, width: 160, height: 120 })
    child.options({ x: 20, y: 20, width: 60, height: 40 })
    group.addChild(child)
    group.onCapture('mousedown', () => order.push('capture-group'))
    group.on('mousedown', () => order.push('bubble-group'))
    child.on('mousedown', (event) => {
      order.push('target-child')
      event.cancelBubble = true
    })
    app.flush()

    app.handleEvent('mousedown', new MouseEvent('mousedown', { clientX: 50, clientY: 50, button: 0 }))

    expect(order).toEqual(['capture-group', 'target-child'])

    app.destroy()
  })

  it('считает return false из pointer handlers остановкой распространения', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const order: Array<string> = []
    const group = surface.createNode(AuditNode, 'group', log)
    const child = new AuditNode(app, surface, 'child', log)

    group.options({ x: 20, y: 20, width: 160, height: 120 })
    child.options({ x: 20, y: 20, width: 60, height: 40 })
    group.addChild(child)
    group.onCapture('mousedown', () => order.push('capture-group'))
    group.on('mousedown', () => order.push('bubble-group'))
    child.on('mousedown', () => {
      order.push('target-child')
      return false
    })
    app.flush()

    app.handleEvent('mousedown', new MouseEvent('mousedown', { clientX: 50, clientY: 50, button: 0 }))

    expect(order).toEqual(['capture-group', 'target-child'])

    app.destroy()
  })

  it('сохраняет автоматический pointer capture, когда handler останавливает всплытие через return false', async () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const events: Array<string> = []
    const node = surface.createNode(AuditNode, 'capture-return-false', log)

    node.options({ x: 10, y: 10, width: 30, height: 30 })
    node.on('mousedown', () => {
      events.push('down')
      return false
    })
    node.on('gotpointercapture', () => events.push('capture'))
    node.on('mousemove', () => {
      events.push('move')
      return false
    })
    node.on('lostpointercapture', () => events.push('release'))
    app.flush()

    dispatchMouse(app.canvas.element, 'mousedown', 20, 20)
    dispatchMouse(app.canvas.element, 'mousemove', 140, 140)
    await waitFrame()
    dispatchMouse(app.canvas.element, 'mouseup', 140, 140)

    expect(events).toEqual(['down', 'capture', 'move', 'release'])
    expect(node.hasPointerCapture()).toBe(false)

    app.destroy()
  })

  it('сохраняет совпадение target пространственного и линейного hit-test', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)

    for (let index = 0; index < 400; index++) {
      const node = surface.createNode(AuditNode, `node-${index}`, log)
      node.options({
        x: (index % 40) * 18,
        y: Math.floor(index / 40) * 18,
        width: 12,
        height: 12,
        zIndex: index,
      })
      node.on('mousedown', vi.fn())
    }

    app.events.hitTestMode = 'linear'
    const linearTarget = app.events.hitTest(22, 22)
    const linearCandidates = app.events.lastHitTestCandidates

    app.events.hitTestMode = 'spatial'
    const spatialTarget = app.events.hitTest(22, 22)
    const spatialCandidates = app.events.lastHitTestCandidates

    expect(spatialTarget).toBe(linearTarget)
    expect(spatialTarget).not.toBeNull()
    expect(linearCandidates).toBe(400)
    expect(spatialCandidates).toBeLessThan(linearCandidates)

    app.destroy()
  })

  it('синхронизирует пространственные индексы при смене родителя, видимости и transform', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const leftGroup = surface.createNode(NovaContainer<TestEvents>)
    const rightGroup = surface.createNode(NovaContainer<TestEvents>)
    const child = new AuditNode(app, surface, 'child', log)

    leftGroup.options({ x: 0, y: 0 })
    rightGroup.options({ x: 200, y: 0 })
    child.options({ x: 10, y: 10, width: 40, height: 40 })
    child.on('mousedown', vi.fn())
    leftGroup.addChild(child)
    app.flush()
    app.events.hitTestMode = 'spatial'

    expect(app.events.hitTest(20, 20)).toBe(child)

    rightGroup.addChild(child)
    app.flush()
    expect(app.events.hitTest(20, 20)).toBeNull()
    expect(app.events.hitTest(220, 20)).toBe(child)

    child.visible = false
    app.flush()
    expect(app.events.hitTest(220, 20)).toBeNull()

    child.visible = true
    child.options({ x: 30, y: 30, scaleX: 2, scaleY: 2 })
    app.flush()
    expect(app.events.hitTest(260, 70)).toBe(child)

    app.destroy()
  })

  it('снимает регистрацию интерактивных узлов при удалении handlers', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const node = surface.createNode(AuditNode, 'interactive', log)
    const handler = vi.fn()

    node.on('mousemove', handler)
    expect(app.events.interactiveNodes.has(node)).toBe(true)

    node.off('mousemove')
    expect(app.events.interactiveNodes.has(node)).toBe(false)

    app.destroy()
  })

  it('публикует поддерживаемый контракт нативных событий без aliases pointer-событий', () => {
    expect(NovaSupportedNativeEvents).toEqual(expect.arrayContaining([
      'click',
      'dblclick',
      'contextmenu',
      'mousedown',
      'mouseup',
      'mousemove',
      'mouseenter',
      'mouseleave',
      'wheel',
      'keydown',
      'keyup',
      'focus',
      'blur',
      'select',
      'deselect',
      'dragstart',
      'dragmove',
      'dragend',
      'dragcancel',
      'gotpointercapture',
      'lostpointercapture',
    ]))
    expect(NovaSupportedNativeEvents).not.toContain('pointerdown')
    expect(NovaSupportedNativeEvents).not.toContain('pointermove')
  })

  it('перерисовывает 500 прямых детей в рамках бюджета mock-кадра', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const nodes = Array.from({ length: 500 }, (_, index) => {
      const node = new AuditNode(app, surface, `node-${index}`, log)
      node.options({ x: index % 100, y: Math.floor(index / 100), width: 4, height: 4 })
      surface.addChild(node, { invalidate: false })
      return node
    })
    surface.dirty({ render: true })

    clearAuditLog(log)
    const elapsedMs = measure('surface redraw / 500 direct children', () => {
      nodes[0].dirty({ render: true })
    })

    expect(log.renders).toHaveLength(500)
    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('сортирует 1000 прямых детей по z-index в рамках бюджета mock-кадра', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const nodes = Array.from({ length: 1000 }, (_, index) => {
      const node = new AuditNode(app, surface, `node-${index}`, log)
      node.options({
        x: index % 100,
        y: Math.floor(index / 100),
        width: 4,
        height: 4,
        zIndex: 1000 - index,
      })
      surface.addChild(node, { invalidate: false })
      return node
    })
    surface.dirty({ render: true })

    clearAuditLog(log)
    const elapsedMs = measure('z-index ordered surface redraw / 1000 direct children', () => {
      nodes[0].dirty({ render: true })
    })

    expect(log.renders).toHaveLength(1000)
    expect(log.renders[0]).toBe('node-999')
    expect(log.renders.at(-1)).toBe('node-0')
    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('рекурсивно отрисовывает вложенную цепочку из 1000 узлов в рамках бюджета mock-кадра', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const root = surface.createNode(AuditNode, 'root', log)
    root.options({ width: 1, height: 1 })

    let parent = root
    for (let index = 0; index < 1000; index++) {
      const child = new AuditNode(app, surface, `child-${index}`, log)
      child.options({ width: 1, height: 1 })
      parent.addChild(child, { invalidate: false })
      parent = child
    }
    surface.dirty({ render: true })

    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    const elapsedMs = measure('recursive surface redraw / 1000-node nested chain', () => {
      surface.doRender()
    })

    expect(log.renders).toHaveLength(1001)
    expect(log.renders[0]).toBe('root')
    expect(log.renders.at(-1)).toBe('child-999')
    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('сортирует 500 поверхностей по z-index при flush в рамках бюджета mock-кадра', () => {
    const log = createAuditLog()
    const app = createApp()

    for (let index = 0; index < 500; index++) {
      app
        .createSurface(`surface-${index}`, AuditSurface, log)
        .options({ zIndex: 500 - index })
    }

    clearAuditLog(log)
    const elapsedMs = measure('z-index ordered app flush / 500 surfaces', () => {
      app.flush()
    })

    expect(log.surfaceFlushes).toHaveLength(500)
    expect(log.surfaceFlushes[0]).toBe('surface-499')
    expect(log.surfaceFlushes.at(-1)).toBe('surface-0')
    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('выполняет hit-test 1000 интерактивных узлов текущим линейным путём событий', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)

    for (let index = 0; index < 1000; index++) {
      const node = new AuditNode(app, surface, `node-${index}`, log)
      node.options({
        x: 10_000 + index * 2,
        y: 10_000,
        width: 1,
        height: 1,
      })
      node.on('mousedown', vi.fn())
      surface.addChild(node, { invalidate: false })
    }
    surface.dirty({ matrix: true, render: true })

    const event = new MouseEvent('mousedown', {
      clientX: 1,
      clientY: 1,
      bubbles: true,
    })

    const elapsedMs = measure('event hit-test / 1000 interactive nodes', () => {
      app.canvas.element.dispatchEvent(event)
    })

    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('выполняет hit-test 10000 интерактивных узлов и 5000 кликов в рамках бюджета пространственных событий', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    let clicks = 0

    for (let index = 0; index < 10_000; index++) {
      const node = new AuditNode(app, surface, `node-${index}`, log)
      node.options({
        x: (index % 100) * 140,
        y: Math.floor(index / 100) * 140,
        width: 8,
        height: 8,
      })
      node.on('mousedown', () => {
        clicks += 1
      })
      surface.addChild(node, { invalidate: false })
    }
    surface.dirty({ matrix: true, render: true })
    app.events.hitTestMode = 'spatial'
    app.flush()
    app.events.hitTest(4, 4)
    const event = new MouseEvent('mousedown', { button: 0 })
    const points = Array.from({ length: 5_000 }, (_item, index) => ({
      x: 4 + (index % 80) * 140,
      y: 4 + (index % 80) * 140,
    }))

    const elapsedMs = measure('event spatial hit-test / 10000 nodes / 5000 clicks', () => {
      for (const point of points) {
        app.events.hitTest(point.x, point.y)?.eventHandlers.mousedown?.(event)
      }
    })

    expect(clicks).toBe(5_000)
    expect(app.events.interactiveNodes.size).toBe(10_000)
    expect(elapsedMs).toBeLessThan(120)

    app.destroy()
  })

  it('обновляет 10000 listener handlers без роста реестра интерактивных узлов', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const node = surface.createNode(AuditNode, 'listener-patch', log)
    const first = vi.fn()
    const second = vi.fn()

    node.on('click', first)
    const elapsedMs = measure('event listener patch / 10000 ops', () => {
      for (let index = 0; index < 10_000; index += 1) {
        node.on('click', index % 2 === 0 ? second : first)
      }
    })

    expect(app.events.interactiveNodes.size).toBe(1)
    expect(node.eventHandlers.click).toBe(first)
    node.off('click')
    expect(app.events.interactiveNodes.size).toBe(0)
    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('запрашивает 10000 узлов пространственного индекса в рамках mock-бюджета', () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => ({
      active: true,
      visible: true,
      getRenderBounds: () => ({
        x: (index % 200) * 12,
        y: Math.floor(index / 200) * 12,
        width: 8,
        height: 8,
      }),
    }))
    const spatialIndex = new NovaSpatialIndex<TestEvents>()

    const rebuildElapsedMs = measure('spatial index rebuild / 10000 nodes', () => {
      spatialIndex.rebuild(nodes as unknown as Iterable<NovaNode<TestEvents>>)
    })
    const queryElapsedMs = measure('spatial index query / 10000 nodes', () => {
      for (let index = 0; index < 1000; index++) {
        spatialIndex.queryPoint(30 + (index % 24), 30 + (index % 24))
      }
    })

    expect(spatialIndex.queryPoint(30, 30).length).toBeLessThan(300)
    expect(rebuildElapsedMs).toBeLessThan(80)
    expect(queryElapsedMs).toBeLessThan(80)
  })

  it('запрашивает hit-индекс на основе rbush с отрицательными, нулевыми и большими границами', () => {
    const items = [
      { id: 'negative', bounds: { x: -50, y: -50, width: 40, height: 40 }, active: true },
      { id: 'zero', bounds: { x: 0, y: 0, width: 0, height: 40 }, active: true },
      { id: 'large', bounds: { x: 100, y: 100, width: 10_000, height: 10_000 }, active: true },
      { id: 'inactive', bounds: { x: 100, y: 100, width: 20, height: 20 }, active: false },
    ]
    const index = new NovaHitIndex<typeof items[number]>({
      getBounds: item => item.bounds,
      isIndexable: item => item.active,
    })

    index.rebuild(items)

    expect(index.indexedNodeCount).toBe(2)
    expect(index.queryPoint(-25, -25).map(item => item.id)).toEqual(['negative'])
    expect(index.lastQueryCandidateCount).toBe(1)
    expect(index.queryPoint(0, 20).map(item => item.id)).toEqual([])
    expect(index.lastQueryCandidateCount).toBe(0)
    expect(index.queryPoint(120, 120).map(item => item.id)).toEqual(['large'])
    expect(index.lastQueryCandidateCount).toBe(1)

    items[0].bounds.x = 200
    items[0].bounds.y = 200
    index.update(items[0])

    expect(index.queryPoint(-25, -25).map(item => item.id)).toEqual([])
    expect(new Set(index.queryBounds({ x: 190, y: 190, width: 40, height: 40 }).map(item => item.id))).toEqual(new Set(['negative', 'large']))

    items[2].active = false
    index.update(items[2])
    expect(index.queryPoint(120, 120)).toEqual([])
  })

  it('запрашивает узлы пространственного индекса по границам без дубликатов', () => {
    const nodes = Array.from({ length: 4 }, (_, index) => ({
      active: true,
      visible: true,
      getRenderBounds: () => ({
        x: index * 64,
        y: index * 64,
        width: 96,
        height: 96,
      }),
    }))
    const spatialIndex = new NovaSpatialIndex<TestEvents>(64)

    spatialIndex.rebuild(nodes as unknown as Iterable<NovaNode<TestEvents>>)

    const result = spatialIndex.queryBounds({ x: 60, y: 60, width: 130, height: 130 })

    expect(new Set(result).size).toBe(result.length)
    expect(result).toContain(nodes[0])
    expect(result).toContain(nodes[1])
    expect(result).toContain(nodes[2])
    expect(result).not.toContain(nodes[3])
  })

  it('инкрементально обновляет 1000 узлов пространственного индекса в рамках mock-бюджета', () => {
    const positions = Array.from({ length: 10_000 }, (_, index) => ({
      x: (index % 200) * 12,
      y: Math.floor(index / 200) * 12,
    }))
    const nodes = positions.map(position => ({
      active: true,
      visible: true,
      getRenderBounds: () => ({
        x: position.x,
        y: position.y,
        width: 8,
        height: 8,
      }),
    }))
    const spatialIndex = new NovaSpatialIndex<TestEvents>()
    spatialIndex.rebuild(nodes as unknown as Iterable<NovaNode<TestEvents>>)

    const updateElapsedMs = measure('spatial index incremental update / 1000 nodes', () => {
      for (let index = 0; index < 1000; index++) {
        positions[index].x += 2400
        spatialIndex.update(nodes[index] as unknown as NovaNode<TestEvents>)
      }
    })

    expect(spatialIndex.indexedNodeCount).toBe(10_000)
    expect(spatialIndex.queryPoint(30, 30).length).toBeLessThan(300)
    expect(updateElapsedMs).toBeLessThan(80)
  })

  it('удерживает hit-test rbush в рамках бюджетов большой и кластеризованной сцены', () => {
    const items = Array.from({ length: 50_000 }, (_, index) => ({
      id: index,
      active: true,
      bounds: {
        x: (index % 500) * 12,
        y: Math.floor(index / 500) * 12,
        width: 8,
        height: 8,
      },
    }))
    const index = new NovaHitIndex<typeof items[number]>({
      getBounds: item => item.bounds,
      isIndexable: item => item.active,
    })
    const rebuildElapsedMs = measure('hit index rbush rebuild / 50000 nodes', () => {
      index.rebuild(items)
    })
    const queryElapsedMs = measure('hit index rbush query / 50000 nodes / 10000 queries', () => {
      for (let step = 0; step < 10_000; step += 1) {
        index.queryPoint((step % 500) * 12 + 2, Math.floor(step / 500) * 12 + 2)
      }
    })
    const clustered = items.map((item, itemIndex) => ({
      ...item,
      bounds: {
        x: itemIndex % 64,
        y: Math.floor(itemIndex % 64),
        width: 96,
        height: 96,
      },
    }))
    const clusteredIndex = new NovaHitIndex<typeof clustered[number]>({
      getBounds: item => item.bounds,
      isIndexable: item => item.active,
    })
    clusteredIndex.rebuild(clustered)
    const clusteredElapsedMs = measure('hit index rbush clustered query / 50000 nodes / 1000 queries', () => {
      for (let step = 0; step < 1_000; step += 1) {
        clusteredIndex.queryPoint(step % 64, step % 64)
      }
    })

    expect(index.indexedNodeCount).toBe(50_000)
    expect(index.queryPoint(2, 2)).toHaveLength(1)
    expect(clusteredIndex.queryPoint(4, 4).length).toBeGreaterThan(1)
    expect(rebuildElapsedMs).toBeLessThan(250)
    expect(queryElapsedMs).toBeLessThan(120)
    expect(clusteredElapsedMs).toBeLessThan(800)
  })

  it('отсекает 1000 заэкранных узлов в рамках бюджета mock-кадра', () => {
    const log = createAuditLog()
    const app = createApp({ width: 320, height: 180 })
    const surface = app.createSurface('scene', AuditSurface, log)
    surface.renderCullingMode = 'bounds'

    for (let index = 0; index < 1000; index++) {
      surface.createNode(AuditNode, `node-${index}`, log).options({ x: 10_000, y: 10_000, width: 3, height: 3 })
    }

    clearAuditLog(log)
    surface.markRenderFrameDirty(true)
    const elapsedMs = measure('bounds culling / 1000 offscreen nodes', () => {
      surface.doRender()
    })

    expect(log.renders).toHaveLength(0)
    expect(surface.renderCullingStats.culledNodes).toBe(1000)
    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('переключает active группы из 1000 узлов через распространение в рамках mock-бюджета', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const group = surface.createNode(AuditNode, 'group', log)
    const children = Array.from({ length: 1000 }, (_, index) => {
      const child = new AuditNode(app, surface, `child-${index}`, log)
      child.options({ width: 1, height: 1 })
      group.addChild(child, { invalidate: false })
      return child
    })
    surface.dirty({ render: true })

    const elapsedMs = measure('active propagation / 1000 nested children', () => {
      group.active = false
    })

    expect(children.every(child => child.active === false)).toBe(true)
    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('переключает visible группы из 1000 узлов в рамках mock-бюджета', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const group = surface.createNode(AuditNode, 'group', log)

    for (let index = 0; index < 1000; index++) {
      const child = new AuditNode(app, surface, `child-${index}`, log)
      child.options({ width: 1, height: 1 })
      group.addChild(child, { invalidate: false })
    }
    surface.dirty({ render: true })

    clearAuditLog(log)
    const hideElapsedMs = measure('visible group hide / 1000 descendants', () => {
      group.visible = false
    })

    expect(log.renders).toEqual([])
    expect(hideElapsedMs).toBeLessThan(80)

    clearAuditLog(log)
    const showElapsedMs = measure('visible group show / 1000 descendants', () => {
      group.visible = true
    })

    expect(log.renders).toHaveLength(1001)
    expect(showElapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('добавляет и очищает 1000 дочерних узлов контейнера в рамках mock-бюджета', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const container = surface.createNode(NovaContainer<TestEvents>)

    const children = Array.from({ length: 1000 }, (_, index) => {
      return new AuditNode(app, surface, `child-${index}`, log)
    })

    const addElapsedMs = measure('container addMany / 1000 children', () => {
      container.addMany(children)
    })

    expect(container.childCount).toBe(1000)
    expect(addElapsedMs).toBeLessThan(80)

    const clearElapsedMs = measure('container clear / 1000 children', () => {
      container.clear()
    })

    expect(container.childCount).toBe(0)
    expect(clearElapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('удаляет интерактивных потомков из состояния input при освобождении группы', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const group = surface.createNode(NovaContainer<TestEvents>)
    const child = new AuditNode(app, surface, 'interactive-child', log)
    child.options({ x: 20, y: 20, width: 40, height: 40 })
    child.on('mousedown', vi.fn())
    group.add(child)

    expect(app.events.interactiveNodes.has(child)).toBe(true)

    group.remove()

    expect(surface.children.includes(group)).toBe(false)
    expect(app.events.interactiveNodes.has(child)).toBe(false)
    expect(app.events.hoveredNodes.has(child)).toBe(false)
    expect(app.events.draggedNodes.has(child)).toBe(false)
    expect(app.events.hitTest(30, 30)).toBeNull()

    app.destroy()
  })

  it('запускает lifecycle hooks NovaScene и удаляет корни при unmount', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)

    /**
     * Описывает сцену TestScene и ее runtime lifecycle.
     */
    class TestScene extends NovaScene<TestEvents> {
      root: LifecycleAuditNode | null = null

      /**
       * Обрабатывает входящее событие TestScene.
       */
      override onMount(): void {
        if (!this.root) {
          this.root = this.addRoot(surface.createNode(LifecycleAuditNode, 'scene-root', log))
        }
      }
    }

    const scene = new TestScene(app)
    scene.mount()

    expect(scene.state).toBe('mounted')
    expect(scene.rootCount).toBe(1)
    expect(scene.root?.lifecycleState).toBe('mounted')
    expect(scene.root?.mountedCount).toBe(1)

    scene.pause()
    expect(scene.state).toBe('paused')
    expect(scene.root?.lifecycleState).toBe('paused')
    expect(scene.root?.pausedCount).toBe(1)

    scene.resume()
    expect(scene.state).toBe('mounted')
    expect(scene.root?.lifecycleState).toBe('mounted')
    expect(scene.root?.resumedCount).toBe(1)

    const root = scene.root!
    scene.unmount()
    expect(scene.state).toBe('created')
    expect(scene.rootCount).toBe(0)
    expect(surface.children.includes(root)).toBe(false)
    expect(root.lifecycleState).toBe('destroyed')
    expect(root.unmountedCount).toBe(1)

    app.destroy()
  })

  it('скрывает и показывает контейнер из 5000 узлов через флаг родителя в рамках mock-бюджета', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface('scene', AuditSurface, log)
    const group = surface.createNode(NovaContainer<TestEvents>)
    const children = Array.from({ length: 5000 }, (_, index) => {
      const child = new AuditNode(app, surface, `child-${index}`, log)
      child.options({ width: 1, height: 1 })
      return child
    })
    group.addMany(children)

    const hideElapsedMs = measure('container hide / 5000 descendants', () => {
      group.hide()
    })
    const showElapsedMs = measure('container show / 5000 descendants', () => {
      group.show()
    })

    expect(group.localVisible).toBe(true)
    expect(children[0].localVisible).toBe(true)
    expect(hideElapsedMs).toBeLessThan(80)
    expect(showElapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('переключает сцены без накопления интерактивных узлов', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)

    /**
     * Описывает сцену SwitchScene и ее runtime lifecycle.
     */
    class SwitchScene extends NovaScene<TestEvents> {
      /**
       * Обрабатывает входящее событие SwitchScene.
       */
      override onMount(): void {
        const root = this.addRoot(surface.createNode(NovaContainer<TestEvents>))
        const child = new AuditNode(app, surface, 'scene-child', log)
        child.options({ x: 10, y: 10, width: 20, height: 20 })
        child.on('mousedown', vi.fn())
        root.add(child)
      }
    }

    const elapsedMs = measure('scene switch / 50 scenes with input cleanup', () => {
      for (let index = 0; index < 50; index++) {
        const scene = new SwitchScene(app)
        scene.mount()
        expect(app.events.interactiveNodes.size).toBe(1)
        scene.destroy()
        expect(app.events.interactiveNodes.size).toBe(0)
      }
    })

    expect(elapsedMs).toBeLessThan(120)

    app.destroy()
  })

  it('сохраняет drag-события на захваченном узле после выхода pointer за его границы', async () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const events: Array<string> = []
    const node = surface.createNode(AuditNode, 'captured', log)
    node.options({ x: 10, y: 10, width: 30, height: 30 })
    node.on('mousedown', (event) => {
      events.push('down')
      node.capturePointer(event)
    })
    node.on('gotpointercapture', () => events.push('capture'))
    node.on('dragstart', (_event, meta) => events.push(`start:${meta.startX}:${meta.startY}`))
    node.on('dragmove', (_event, _dx, _dy, meta) => events.push(`move:${meta.totalDx}:${meta.totalDy}`))
    node.on('dragend', (_event, meta) => events.push(`end:${meta.totalDx}:${meta.totalDy}`))
    node.on('lostpointercapture', () => events.push('release'))
    app.flush()

    dispatchMouse(app.canvas.element, 'mousedown', 20, 20)
    dispatchMouse(app.canvas.element, 'mousemove', 140, 140)
    await waitFrame()
    dispatchMouse(app.canvas.element, 'mouseup', 140, 140)

    expect(events).toEqual(['down', 'capture', 'start:20:20', 'move:120:120', 'end:120:120', 'release'])
    expect(node.hasPointerCapture()).toBe(false)

    app.destroy()
  })

  it('учитывает отключённый автоматический pointer capture, сохраняя доступность ручного захвата', () => {
    const log = createAuditLog()
    const app = createApp({ input: true, pointerCapture: false })
    const surface = app.createSurface('scene', AuditSurface, log)
    const events: Array<string> = []
    const node = surface.createNode(AuditNode, 'manual-capture', log)
    node.options({ x: 10, y: 10, width: 30, height: 30 })
    node.on('mousedown', () => events.push('down'))
    node.on('gotpointercapture', () => events.push('capture'))
    app.flush()

    dispatchMouse(app.canvas.element, 'mousedown', 20, 20)

    expect(node.hasPointerCapture()).toBe(false)
    expect(events).toEqual(['down'])

    const event = new MouseEvent('mousedown', { clientX: 20, clientY: 20, button: 0, bubbles: true })
    node.capturePointer(event)

    expect(node.hasPointerCapture(event)).toBe(true)
    expect(events).toEqual(['down', 'capture'])

    app.destroy()
  })

  it('сохраняет независимые pointer captures по pointerId', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const first = surface.createNode(AuditNode, 'first-pointer', log)
    const second = surface.createNode(AuditNode, 'second-pointer', log)
    const events: Array<string> = []

    first.options({ x: 10, y: 10, width: 30, height: 30 })
    second.options({ x: 60, y: 10, width: 30, height: 30 })
    first.on('mousedown', (event) => {
      first.capturePointer(event)
      events.push('first-down')
    })
    second.on('mousedown', (event) => {
      second.capturePointer(event)
      events.push('second-down')
    })
    first.on('lostpointercapture', () => events.push('first-release'))
    second.on('lostpointercapture', () => events.push('second-release'))
    app.flush()

    const firstDown = dispatchPointer(app.canvas.element, 'mousedown', 20, 20, 11)
    const secondDown = dispatchPointer(app.canvas.element, 'mousedown', 70, 20, 22)

    expect(first.hasPointerCapture(firstDown)).toBe(true)
    expect(second.hasPointerCapture(secondDown)).toBe(true)

    dispatchPointer(app.canvas.element, 'mouseup', 20, 20, 11)

    expect(first.hasPointerCapture(firstDown)).toBe(false)
    expect(second.hasPointerCapture(secondDown)).toBe(true)
    expect(events).toEqual(['first-down', 'second-down', 'first-release'])

    app.destroy()
  })

  it('отправляет hover enter и leave при изменении верхней target', async () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const events: Array<string> = []
    const first = surface.createNode(AuditNode, 'first', log)
    first.options({ x: 10, y: 10, width: 20, height: 20 })
    first.on('mouseenter', () => events.push('first-enter'))
    first.on('mouseleave', () => events.push('first-leave'))
    first.on('hover', (_event, hovered) => events.push(`first-hover-${hovered}`))
    const second = surface.createNode(AuditNode, 'second', log)
    second.options({ x: 50, y: 10, width: 20, height: 20 })
    second.on('mouseenter', () => events.push('second-enter'))

    dispatchMouse(app.canvas.element, 'mousemove', 15, 15)
    await waitFrame()
    dispatchMouse(app.canvas.element, 'mousemove', 55, 15)
    await waitFrame()

    expect(events).toEqual(['first-enter', 'first-hover-true', 'first-leave', 'first-hover-false', 'second-enter'])

    app.destroy()
  })

  it('направляет события клавиатуры сфокусированному узлу и поддерживает состояние выбора', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const events: Array<string> = []
    const first = surface.createNode(AuditNode, 'first', log)
    first.options({ x: 10, y: 10, width: 20, height: 20 })
    first.on('mousedown', (event) => {
      first.select({}, event)
    })
    first.on('focus', () => events.push('first-focus'))
    first.on('blur', () => events.push('first-blur'))
    first.on('select', () => events.push('first-select'))
    first.on('keydown', event => events.push(`first-key-${event.key}`))
    const second = surface.createNode(AuditNode, 'second', log)
    second.options({ x: 50, y: 10, width: 20, height: 20 })
    second.on('mousedown', event => second.select({}, event))
    second.on('focus', () => events.push('second-focus'))
    app.flush()

    dispatchMouse(app.canvas.element, 'mousedown', 15, 15)
    app.events.handle('keydown', new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(app.events.focusedNode).toBe(first)
    expect(first.selected).toBe(true)
    expect(events).toContain('first-key-Enter')

    dispatchMouse(app.canvas.element, 'mousedown', 55, 15)

    expect(app.events.focusedNode).toBe(second)
    expect(first.selected).toBe(false)
    expect(second.selected).toBe(true)
    expect(events).toEqual(['first-focus', 'first-select', 'first-key-Enter', 'first-blur', 'second-focus'])

    app.destroy()
  })

  it('изолирует выбор и фокус явными scopes', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const first = surface.createNode(AuditNode, 'first', log)
    const second = surface.createNode(AuditNode, 'second', log)

    first.options({ x: 10, y: 10, width: 20, height: 20 })
    second.options({ x: 50, y: 10, width: 20, height: 20 })

    app.events.select(first, { scope: 'inspector' })
    app.events.select(second)
    app.events.focus(first, new Event('focus'), 'inspector')
    app.events.focus(second)

    expect(first.selected).toBe(false)
    expect(first.selectedIn('inspector')).toBe(true)
    expect(second.selected).toBe(true)
    expect(first.focused).toBe(false)
    expect(first.focusedIn('inspector')).toBe(true)
    expect(second.focused).toBe(true)

    app.events.clearSelection(new Event('deselect'), 'inspector')
    app.events.blur(first, new Event('blur'), 'inspector')

    expect(first.selectedIn('inspector')).toBe(false)
    expect(second.selected).toBe(true)
    expect(first.focusedIn('inspector')).toBe(false)
    expect(second.focused).toBe(true)

    app.destroy()
  })

  it('обрабатывает 1000 захваченных перемещений drag в рамках mock-бюджета', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface('scene', AuditSurface, log)
    const node = surface.createNode(AuditNode, 'drag', log)
    let moves = 0
    node.options({ x: 10, y: 10, width: 30, height: 30 })
    node.on('mousedown', event => node.capturePointer(event))
    node.on('dragmove', () => {
      moves += 1
    })

    dispatchMouse(app.canvas.element, 'mousedown', 20, 20)
    const elapsedMs = measure('captured drag / 1000 direct move frames', () => {
      for (let index = 0; index < 1000; index++) {
        const event = new MouseEvent('mousemove', {
          clientX: 40 + index,
          clientY: 40,
          bubbles: true,
        })
        ;(app.events as unknown as { _handleMouseMove: (event: MouseEvent) => boolean })._handleMouseMove(event)
      }
    })

    expect(moves).toBe(1000)
    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })
})
