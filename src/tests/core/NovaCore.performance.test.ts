import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,
  NovaContainer,
  NovaNode,
  NovaScene,
  NovaSpatialIndex,
  NovaSurface,
  RaphSchedulerType,
  RendererType,
  type NovaApp,
} from '@/index'
import type { EventList } from '@endge/utils'

type TestEvents = EventList

type AuditLog = {
  renders: string[]
  updates: string[]
  surfaceFlushes: string[]
  surfaceRenders: string[]
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
    get(target, prop) {
      if (!(prop in target)) {
        target[prop] = vi.fn()
      }
      return target[prop]
    },
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

function createApp(options: { width?: number; height?: number; input?: boolean; pointerCapture?: boolean } = {}): NovaApp<TestEvents> {
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

class AuditNode extends NovaNode<TestEvents> {
  renderCount = 0
  updateCount = 0

  constructor(
    app: NovaApp<TestEvents>,
    surface: NovaSurface<TestEvents>,
    private readonly _name: string,
    private readonly _log: AuditLog,
  ) {
    super(app, surface)
  }

  override render(): void {
    this.renderCount += 1
    this._log.renders.push(this._name)
  }

  override update(): void {
    this.updateCount += 1
    this._log.updates.push(this._name)
  }
}

class AuditSurface extends NovaSurface<TestEvents> {
  private _auditLog?: AuditLog

  constructor(
    name: string,
    app: NovaApp<TestEvents>,
    type: RendererType,
    log: AuditLog,
  ) {
    super(name, app, type)
    this._auditLog = log
  }

  override doRender(): void {
    this._auditLog?.surfaceRenders.push(this.name)
    super.doRender()
  }

  override flush(mainCtx: CanvasRenderingContext2D): void {
    this._auditLog?.surfaceFlushes.push(this.name)
    super.flush(mainCtx)
  }
}

class LifecycleAuditNode extends AuditNode {
  mountedCount = 0
  unmountedCount = 0
  pausedCount = 0
  resumedCount = 0

  override onMount(): void {
    this.mountedCount += 1
  }

  override onUnmount(): void {
    this.unmountedCount += 1
  }

  override onPause(): void {
    this.pausedCount += 1
  }

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

describe('Nova core behavior and performance smoke', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('renders direct surface children by zIndex while keeping zIndex as weight', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)

    const first = surface.createNode(AuditNode, 'first-inserted-z100', log)
    first.options({ width: 10, height: 10, zIndex: 100 })
    const second = surface.createNode(AuditNode, 'second-inserted-z0', log)
    second.options({ width: 10, height: 10, zIndex: 0 })

    clearAuditLog(log)
    surface.markRenderSubtreeDirty(true)
    surface.doRender()

    expect(first.weight).toBe(100)
    expect(second.weight).toBe(0)
    expect(log.renders).toEqual(['second-inserted-z0', 'first-inserted-z100'])

    app.destroy()
  })

  it('keeps direct surface child insertion order when zIndex values are equal', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)

    surface.createNode(AuditNode, 'first-z10', log).options({ width: 10, height: 10, zIndex: 10 })
    surface.createNode(AuditNode, 'second-z10', log).options({ width: 10, height: 10, zIndex: 10 })
    surface.createNode(AuditNode, 'third-z10', log).options({ width: 10, height: 10, zIndex: 10 })

    clearAuditLog(log)
    surface.markRenderSubtreeDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['first-z10', 'second-z10', 'third-z10'])

    app.destroy()
  })

  it('flushes surfaces by zIndex while keeping zIndex as weight', () => {
    const log = createAuditLog()
    const app = createApp()

    app.createSurface2D('inserted-first-z100', AuditSurface, log).options({ zIndex: 100 })
    app.createSurface2D('inserted-second-z0', AuditSurface, log).options({ zIndex: 0 })

    clearAuditLog(log)
    app.flush()

    expect(log.surfaceFlushes).toEqual(['inserted-second-z0', 'inserted-first-z100'])

    app.destroy()
  })

  it('isolates main canvas transform while compositing a surface', () => {
    const log = createAuditLog()
    const app = createApp({ width: 100, height: 80 })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    const ctx = app.canvas.getContext2D()

    surface.flush(ctx)

    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
    expect(ctx.scale).toHaveBeenCalledWith(2, 2)
    expect(ctx.drawImage).toHaveBeenCalledWith(surface.canvas.element, 0, 0, 200, 160, 0, 0, 100, 80)
    expect(ctx.restore).toHaveBeenCalled()

    app.destroy()
  })

  it('keeps surface insertion order when zIndex values are equal', () => {
    const log = createAuditLog()
    const app = createApp()

    app.createSurface2D('first-z10', AuditSurface, log).options({ zIndex: 10 })
    app.createSurface2D('second-z10', AuditSurface, log).options({ zIndex: 10 })
    app.createSurface2D('third-z10', AuditSurface, log).options({ zIndex: 10 })

    clearAuditLog(log)
    app.flush()

    expect(log.surfaceFlushes).toEqual(['first-z10', 'second-z10', 'third-z10'])

    app.destroy()
  })

  it('renders nested descendants during surface-level redraw', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)

    const group = surface.createNode(AuditNode, 'group', log)
    group.options({ width: 100, height: 100 })
    const child = new AuditNode(app, surface, 'nested-child', log)
    child.options({ width: 10, height: 10 })
    group.addChild(child)

    clearAuditLog(log)
    surface.markRenderSubtreeDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['group', 'nested-child'])

    app.destroy()
  })

  it('marks the whole surface for redraw when one direct child becomes render-dirty', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('computes active from local active and restores inherited active when parent is reactivated', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('keeps visible render-only and active update-only for node lifecycle', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('computes visible from local visible and inherited parent visibility', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
    const group = surface.createNode(AuditNode, 'group', log)
    const child = new AuditNode(app, surface, 'child', log)
    group.addChild(child)

    group.visible = false
    clearAuditLog(log)
    surface.markRenderSubtreeDirty(true)
    surface.doRender()

    expect(group.visible).toBe(false)
    expect(child.localVisible).toBe(true)
    expect(child.visible).toBe(false)
    expect(log.renders).toEqual([])

    group.visible = true
    child.visible = false
    clearAuditLog(log)
    surface.markRenderSubtreeDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['group'])
    expect(child.localVisible).toBe(false)
    expect(child.visible).toBe(false)

    child.visible = true
    clearAuditLog(log)
    surface.markRenderSubtreeDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['group', 'child'])

    app.destroy()
  })

  it('uses NovaContainer API to add, remove, clear and bulk-toggle children', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('calculates local, world and container bounds', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('calculates exact render bounds from schema items', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    const node = surface.createNode(AuditNode, 'schema-node', log)

    node.options({ x: 20, y: 30, width: 1, height: 1 })
    node.setRenderBoundsFromSchema([
      { type: 'line', x1: 10, y1: 12, x2: 70, y2: 12, styles: { width: 4 } },
      { type: 'circle', x: 120, y: 40, radius: 10 },
      { type: 'text', text: 'label', x: 150, y: 8, width: 80, height: 18 },
    ])
    node.on('mousedown', vi.fn())

    expect(node.getLocalRenderBounds()).toEqual({ x: 8, y: 8, width: 222, height: 42 })
    expect(node.getRenderBounds()).toEqual({ x: 28, y: 38, width: 222, height: 42 })
    expect(node.containsPoint(34, 42)).toBe(true)
    expect(node.containsPoint(23, 33)).toBe(false)

    app.events.hitTestMode = 'spatial'
    expect(app.events.hitTest(190, 48)).toBe(node)

    app.destroy()
  })

  it('uses transform hierarchy for hit testing and coordinate conversion', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('culls nodes outside surface bounds when bounds culling is enabled', () => {
    const log = createAuditLog()
    const app = createApp({ width: 320, height: 180 })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    surface.renderCullingMode = 'bounds'

    surface.createNode(AuditNode, 'visible', log).options({ x: 20, y: 20, width: 40, height: 30 })
    surface.createNode(AuditNode, 'outside', log).options({ x: 600, y: 20, width: 40, height: 30 })

    clearAuditLog(log)
    surface.markRenderSubtreeDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['visible'])
    expect(surface.renderCullingStats.testedNodes).toBe(2)
    expect(surface.renderCullingStats.culledNodes).toBe(1)

    app.destroy()
  })

  it('keeps a culling root renderable when it exposes viewport bounds before children exist', () => {
    const log = createAuditLog()
    const app = createApp({ width: 320, height: 180 })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    surface.renderCullingMode = 'bounds'

    class ViewportRootNode extends NovaContainer<TestEvents> {
      override render(): void {
        if (this.childCount > 0) return

        const child = new AuditNode(this.nova, this.surface, 'late-child', log)
        child.options({ x: 20, y: 20, width: 40, height: 30 })
        this.add(child)
      }

      override getRenderBounds(): { x: number; y: number; width: number; height: number } {
        return { x: 0, y: 0, width: this.nova.width, height: this.nova.height }
      }
    }

    surface.createNode(ViewportRootNode).options({ width: 320, height: 180 })

    clearAuditLog(log)
    surface.markRenderSubtreeDirty(true)
    surface.doRender()

    expect(log.renders).toEqual(['late-child'])
    expect(surface.renderCullingStats.culledNodes).toBe(0)

    app.destroy()
  })

  it('culls an empty container before it can create children without explicit render bounds', () => {
    const log = createAuditLog()
    const app = createApp({ width: 320, height: 180 })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    surface.renderCullingMode = 'bounds'

    class EmptyBoundsContainerNode extends NovaContainer<TestEvents> {
      override render(): void {
        const child = new AuditNode(this.nova, this.surface, 'late-child', log)
        child.options({ x: 20, y: 20, width: 40, height: 30 })
        this.add(child)
      }
    }

    surface.createNode(EmptyBoundsContainerNode)

    clearAuditLog(log)
    surface.markRenderSubtreeDirty(true)
    surface.doRender()

    expect(log.renders).toEqual([])
    expect(surface.renderCullingStats.culledNodes).toBe(1)

    app.destroy()
  })

  it('returns the visual top node during overlapping hit-test', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('uses render-order stamps for equal z-index direct sibling hit-test', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('hit-tests a node by custom render bounds when local bounds are only a placeholder', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)

    class RenderBoundsHitNode extends AuditNode {
      override getRenderBounds(): { x: number; y: number; width: number; height: number } {
        return { x: 120, y: 80, width: 180, height: 40 }
      }

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

  it('updates spatial index incrementally when one node moves or is removed', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('dispatches pointer events through capture, target and bubble phases', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    const order: string[] = []
    const group = surface.createNode(AuditNode, 'group', log)
    const child = new AuditNode(app, surface, 'child', log)

    group.options({ x: 20, y: 20, width: 160, height: 120 })
    child.options({ x: 20, y: 20, width: 60, height: 40 })
    group.addChild(child)
    group.onCapture('mousedown', () => order.push('capture-group'))
    group.on('mousedown', () => order.push('bubble-group'))
    child.on('mousedown', () => order.push('target-child'))

    app.handleEvent('mousedown', new MouseEvent('mousedown', { clientX: 50, clientY: 50, button: 0 }))

    expect(order).toEqual(['capture-group', 'target-child', 'bubble-group'])

    app.destroy()
  })

  it('stops pointer bubbling when target cancels propagation', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    const order: string[] = []
    const group = surface.createNode(AuditNode, 'group', log)
    const child = new AuditNode(app, surface, 'child', log)

    group.options({ x: 20, y: 20, width: 160, height: 120 })
    child.options({ x: 20, y: 20, width: 60, height: 40 })
    group.addChild(child)
    group.onCapture('mousedown', () => order.push('capture-group'))
    group.on('mousedown', () => order.push('bubble-group'))
    child.on('mousedown', event => {
      order.push('target-child')
      event.cancelBubble = true
    })

    app.handleEvent('mousedown', new MouseEvent('mousedown', { clientX: 50, clientY: 50, button: 0 }))

    expect(order).toEqual(['capture-group', 'target-child'])

    app.destroy()
  })

  it('keeps spatial hit-test target equal to linear hit-test target', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)

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

  it('unregisters interactive nodes when handlers are removed', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    const node = surface.createNode(AuditNode, 'interactive', log)
    const handler = vi.fn()

    node.on('mousemove', handler)
    expect(app.events.interactiveNodes.has(node)).toBe(true)

    node.off('mousemove')
    expect(app.events.interactiveNodes.has(node)).toBe(false)

    app.destroy()
  })

  it('redraws 500 direct children inside a mock frame budget', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('sorts 1000 z-indexed direct children inside a mock frame budget', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('renders a 1000-node nested chain recursively inside a mock frame budget', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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
    surface.markRenderSubtreeDirty(true)
    const elapsedMs = measure('recursive surface redraw / 1000-node nested chain', () => {
      surface.doRender()
    })

    expect(log.renders).toHaveLength(1001)
    expect(log.renders[0]).toBe('root')
    expect(log.renders.at(-1)).toBe('child-999')
    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('sorts 500 z-indexed surfaces during flush inside a mock frame budget', () => {
    const log = createAuditLog()
    const app = createApp()

    for (let index = 0; index < 500; index++) {
      app
        .createSurface2D(`surface-${index}`, AuditSurface, log)
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

  it('hit-tests 1000 interactive nodes with the current linear event path', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)

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

  it('queries 10000 spatial-indexed nodes inside a mock budget', () => {
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

  it('queries spatial-indexed nodes by bounds without duplicates', () => {
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

  it('updates 1000 spatial-indexed nodes incrementally inside a mock budget', () => {
    const positions = Array.from({ length: 10_000 }, (_, index) => ({
      x: (index % 200) * 12,
      y: Math.floor(index / 200) * 12,
    }))
    const nodes = positions.map((position) => ({
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

  it('culls 1000 offscreen nodes inside a mock frame budget', () => {
    const log = createAuditLog()
    const app = createApp({ width: 320, height: 180 })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    surface.renderCullingMode = 'bounds'

    for (let index = 0; index < 1000; index++) {
      surface.createNode(AuditNode, `node-${index}`, log).options({ x: 10_000, y: 10_000, width: 3, height: 3 })
    }

    clearAuditLog(log)
    surface.markRenderSubtreeDirty(true)
    const elapsedMs = measure('bounds culling / 1000 offscreen nodes', () => {
      surface.doRender()
    })

    expect(log.renders).toHaveLength(0)
    expect(surface.renderCullingStats.culledNodes).toBe(1000)
    expect(elapsedMs).toBeLessThan(80)

    app.destroy()
  })

  it('toggles active for a 1000-node group through propagation inside a mock budget', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('toggles visible for a 1000-node group inside a mock budget', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('adds and clears 1000 container children inside a mock budget', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('removes interactive descendants from input state when a group is disposed', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('runs NovaScene lifecycle hooks and removes roots on unmount', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)

    class TestScene extends NovaScene<TestEvents> {
      root: LifecycleAuditNode | null = null

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

  it('hides and shows a 5000-node container through the parent flag inside a mock budget', () => {
    const log = createAuditLog()
    const app = createApp()
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('switches scenes without accumulating interactive nodes', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)

    class SwitchScene extends NovaScene<TestEvents> {
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

  it('keeps drag events on the captured node when pointer leaves its bounds', async () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    const events: Array<string> = []
    const node = surface.createNode(AuditNode, 'captured', log)
    node.options({ x: 10, y: 10, width: 30, height: 30 })
    node.on('mousedown', event => {
      events.push('down')
      node.capturePointer(event)
    })
    node.on('gotpointercapture', () => events.push('capture'))
    node.on('dragstart', (_event, meta) => events.push(`start:${meta.startX}:${meta.startY}`))
    node.on('dragmove', (_event, _dx, _dy, meta) => events.push(`move:${meta.totalDx}:${meta.totalDy}`))
    node.on('dragend', (_event, meta) => events.push(`end:${meta.totalDx}:${meta.totalDy}`))
    node.on('lostpointercapture', () => events.push('release'))

    dispatchMouse(app.canvas.element, 'mousedown', 20, 20)
    dispatchMouse(app.canvas.element, 'mousemove', 140, 140)
    await waitFrame()
    dispatchMouse(app.canvas.element, 'mouseup', 140, 140)

    expect(events).toEqual(['down', 'capture', 'start:20:20', 'move:120:120', 'end:120:120', 'release'])
    expect(node.hasPointerCapture()).toBe(false)

    app.destroy()
  })

  it('honors disabled automatic pointer capture while keeping manual capture available', () => {
    const log = createAuditLog()
    const app = createApp({ input: true, pointerCapture: false })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    const events: Array<string> = []
    const node = surface.createNode(AuditNode, 'manual-capture', log)
    node.options({ x: 10, y: 10, width: 30, height: 30 })
    node.on('mousedown', () => events.push('down'))
    node.on('gotpointercapture', () => events.push('capture'))

    dispatchMouse(app.canvas.element, 'mousedown', 20, 20)

    expect(node.hasPointerCapture()).toBe(false)
    expect(events).toEqual(['down'])

    const event = new MouseEvent('mousedown', { clientX: 20, clientY: 20, button: 0, bubbles: true })
    node.capturePointer(event)

    expect(node.hasPointerCapture(event)).toBe(true)
    expect(events).toEqual(['down', 'capture'])

    app.destroy()
  })

  it('keeps independent pointer captures by pointerId', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    const first = surface.createNode(AuditNode, 'first-pointer', log)
    const second = surface.createNode(AuditNode, 'second-pointer', log)
    const events: Array<string> = []

    first.options({ x: 10, y: 10, width: 30, height: 30 })
    second.options({ x: 60, y: 10, width: 30, height: 30 })
    first.on('mousedown', event => {
      first.capturePointer(event)
      events.push('first-down')
    })
    second.on('mousedown', event => {
      second.capturePointer(event)
      events.push('second-down')
    })
    first.on('lostpointercapture', () => events.push('first-release'))
    second.on('lostpointercapture', () => events.push('second-release'))

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

  it('emits hover enter and leave when the top target changes', async () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('routes keyboard events to the focused node and supports selection state', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
    const events: Array<string> = []
    const first = surface.createNode(AuditNode, 'first', log)
    first.options({ x: 10, y: 10, width: 20, height: 20 })
    first.on('mousedown', event => {
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

  it('keeps selection and focus isolated by explicit scopes', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
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

  it('processes 1000 captured drag moves inside a mock budget', () => {
    const log = createAuditLog()
    const app = createApp({ input: true })
    const surface = app.createSurface2D('scene', AuditSurface, log)
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
