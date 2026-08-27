// @vitest-environment jsdom

import type { EventList } from '@endge/utils'
import type { NovaApp, NovaComponentDescriptor, NovaCursorRuntimeState, NovaSchema, NovaSurface } from '@/index'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,

  NovaComponentNode,

  NovaNode,

  RaphSchedulerType,
  RendererType,
  resolveNovaCursorValue,
} from '@/index'

type TestEvents = EventList

interface TestCursorProps extends Record<string, unknown> {
  active?: boolean
}

let componentCreateCount = 0

/**
 * Описывает Nova-node TestCursorNode и его runtime-поведение.
 */
let TEST_CURSOR_DESCRIPTOR: NovaComponentDescriptor<
  TestCursorProps,
  Record<string, never>,
  Record<string, never>,
  TestCursorProps
>

class TestCursorNode<E extends TestEvents>
  extends NovaComponentNode<TestCursorProps, Record<string, never>, Record<string, never>, TestCursorProps, E> {
  /**
   * Создает экземпляр TestCursorNode и подготавливает базовое состояние.
   */
  constructor(app: NovaApp<E>, surface: NovaSurface<E>, props: TestCursorProps, componentId?: string) {
    super(app, surface, TEST_CURSOR_DESCRIPTOR, props, { componentId })
    componentCreateCount += 1
    this.options({ width: 24, height: 24, interactive: false })
  }

  /**
   * Выполняет отрисовку TestCursorNode.
   */
  override render(): void {
    const schema: NovaSchema = [
      {
        type: 'circle',
        x: 12,
        y: 12,
        radius: this.props.active ? 11 : 9,
        styles: { background: this.props.active ? '#ef4444' : '#111827' },
      },
    ]
    this.renderer.schema(schema)
  }
}

TEST_CURSOR_DESCRIPTOR = {
  type: 'test.cursor',
  name: 'TestCursor',
  version: '0.1.0',
  kind: 'node-component',
  dirtyPolicy: { render: ['active'] },
  createNode: (context, schema) => new TestCursorNode(
    context.app,
    context.surface,
    schema.props ?? {},
    schema.id,
  ),
}
/**
 * Описывает Nova-node CursorBoxNode и его runtime-поведение.
 */
class CursorBoxNode extends NovaNode<TestEvents> {
  /**
   * Выполняет отрисовку CursorBoxNode.
   */
  override render(): void {
    this.renderer.schema([
      {
        type: 'rect',
        x: 0,
        y: 0,
        width: this.width,
        height: this.height,
        styles: { background: '#ffffff' },
      },
    ])
  }
}

/**
 * Описывает node, который имитирует legacy render cursor writer.
 */
class CursorResetRenderNode extends NovaNode<TestEvents> {
  /**
   * Выполняет отрисовку CursorResetRenderNode.
   */
  override render(): void {
    this.renderer.cursor('default')
  }
}

function create2DContextStub(): CanvasRenderingContext2D {
  const state: Record<PropertyKey, any> = {
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
    value: 1,
    configurable: true,
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type === RendererType.Web2D) {
      return create2DContextStub()
    }
    return null
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLCanvasElement) {
    const width = this.width || 800
    const height = this.height || 480
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

function createApp(input = false): NovaApp<TestEvents> {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return Nova.createApp<TestEvents>({
    target: canvas,
    size: { width: 800, height: 480, dpr: 1 },
    input: {
      pointer: { enabled: input, capture: true },
      keyboard: { enabled: false, scope: 'manual' },
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

function dispatchMouse(canvas: HTMLCanvasElement, type: string, x: number, y: number): void {
  canvas.dispatchEvent(new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
  }))
}

function createRuntimeState(patch: Partial<NovaCursorRuntimeState<TestEvents>> = {}): NovaCursorRuntimeState<TestEvents> {
  return {
    x: 12,
    y: 12,
    hover: true,
    pressed: false,
    dragging: false,
    disabled: false,
    target: null,
    source: {} as NovaNode<TestEvents>,
    context: {},
    ...patch,
  }
}

describe('nova cursor system', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    componentCreateCount = 0
    installCanvasMocks()
  })

  it('resolves native/url/component state maps by priority', () => {
    const declaration = {
      default: 'default',
      hover: 'pointer',
      pressed: 'crosshair',
      dragging: 'grabbing',
      disabled: 'not-allowed',
    } as const

    expect(resolveNovaCursorValue(declaration, createRuntimeState())).toBe('pointer')
    expect(resolveNovaCursorValue(declaration, createRuntimeState({ pressed: true }))).toBe('crosshair')
    expect(resolveNovaCursorValue(declaration, createRuntimeState({ dragging: true, pressed: true }))).toBe('grabbing')
    expect(resolveNovaCursorValue(declaration, createRuntimeState({ disabled: true, dragging: true }))).toBe('not-allowed')
  })

  it('resolves cursor rules with state and cursorContext values', () => {
    const declaration = [
      { when: { state: 'dragging', axis: 'x' }, use: { type: 'component', component: 'test.cursor', props: { active: true } } },
      { when: { state: 'hover', axis: 'x' }, use: 'ew-resize' },
      { when: { state: 'hover' }, use: 'pointer' },
    ] as const

    expect(resolveNovaCursorValue(declaration, createRuntimeState({ context: { axis: 'x' }, dragging: true }))).toEqual({
      type: 'component',
      component: 'test.cursor',
      props: { active: true },
    })
    expect(resolveNovaCursorValue(declaration, createRuntimeState({ context: { axis: 'x' } }))).toBe('ew-resize')
    expect(resolveNovaCursorValue(declaration, createRuntimeState({ context: { axis: 'y' } }))).toBe('pointer')
  })

  it('applies native and url cursors from node declarations and root fallback', () => {
    const app = createApp()
    const surface = app.createSurface('cursor')
    const root = surface.createNode(CursorBoxNode)
    root.options({
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      cursor: {
        default: { type: 'url', src: '/cursors/cursor-pointer.svg', hotspot: { x: 2, y: 2 }, fallback: 'default' },
      },
    })
    const child = surface.createNode(CursorBoxNode)
    child.options({ x: 20, y: 20, width: 80, height: 60, cursor: 'pointer', interactive: true, zIndex: 10 })

    app.cursors.syncPointer({ x: 40, y: 40, target: child })
    expect(app.canvas.element.style.cursor).toBe('pointer')

    app.cursors.syncPointer({ x: 150, y: 100, target: null })
    expect(app.canvas.element.style.cursor).toBe('url("/cursors/cursor-pointer.svg") 2 2, default')

    app.destroy()
  })

  it('keeps cursor-only nodes out of pointer event dispatch', () => {
    const app = createApp(true)
    const surface = app.createSurface('cursor')
    const interactive = surface.createNode(CursorBoxNode)
    const cursorOnly = surface.createNode(CursorBoxNode)
    const mouseDown = vi.fn()
    interactive.options({ x: 20, y: 20, width: 120, height: 80, interactive: true, zIndex: 0 })
    interactive.on('mousedown', mouseDown)
    cursorOnly.options({ x: 20, y: 20, width: 120, height: 80, cursor: 'pointer', zIndex: 10 })

    dispatchMouse(app.canvas.element, 'mousedown', 40, 40)

    expect(mouseDown).toHaveBeenCalledTimes(1)
    expect(app.cursors.lastSource).toBe(cursorOnly)
    expect(app.canvas.element.style.cursor).toBe('pointer')

    app.destroy()
  })

  it('respects shape-level hit-test for cursor source resolution', () => {
    const app = createApp()
    const surface = app.createSurface('cursor')
    const bottom = surface.createNode(CursorBoxNode)
    const top = surface.createNode(CursorBoxNode)

    bottom.options({ x: 20, y: 20, width: 120, height: 80, cursor: 'crosshair', zIndex: 0 })
    top.options({
      x: 20,
      y: 20,
      width: 120,
      height: 80,
      cursor: 'pointer',
      zIndex: 10,
      hitTest: ({ localX, localY }) => localX >= 40 && localX <= 80 && localY >= 20 && localY <= 60,
    })

    app.cursors.syncPointer({ x: 80, y: 60, target: null })
    expect(app.cursors.lastSource).toBe(top)
    expect(app.canvas.element.style.cursor).toBe('pointer')

    app.cursors.syncPointer({ x: 24, y: 24, target: null })
    expect(app.cursors.lastSource).toBe(bottom)
    expect(app.canvas.element.style.cursor).toBe('crosshair')

    app.destroy()
  })

  it('reapplies hover cursor when an external writer resets the canvas style', () => {
    const app = createApp()
    const surface = app.createSurface('cursor')
    const node = surface.createNode(CursorBoxNode)
    node.options({ x: 20, y: 20, width: 120, height: 80, cursor: 'pointer', interactive: true })

    app.cursors.syncPointer({ x: 40, y: 40, target: node })
    expect(app.canvas.element.style.cursor).toBe('pointer')

    app.canvas.element.style.cursor = 'default'
    app.cursors.syncPointer({ x: 44, y: 44, target: node })

    expect(app.cursors.lastDomCursor).toBe('pointer')
    expect(app.canvas.element.style.cursor).toBe('pointer')

    app.destroy()
  })

  it('keeps cursor manager value authoritative after render flush cursor commands', () => {
    const app = createApp()
    const surface = app.createSurface('cursor')
    const reset = surface.createNode(CursorResetRenderNode)
    const node = surface.createNode(CursorBoxNode)
    reset.options({ x: 0, y: 0, width: 10, height: 10 })
    node.options({ x: 20, y: 20, width: 120, height: 80, cursor: 'pointer', interactive: true })

    app.raph.run()
    app.cursors.syncPointer({ x: 40, y: 40, target: node })
    expect(app.canvas.element.style.cursor).toBe('pointer')

    reset.dirty({ render: true })
    app.raph.run()

    expect(app.cursors.lastDomCursor).toBe('pointer')
    expect(app.canvas.element.style.cursor).toBe('pointer')

    app.destroy()
  })

  it('keeps previous cursor source while a dirty cursor index temporarily misses it', () => {
    const app = createApp()
    const surface = app.createSurface('cursor')
    const node = surface.createNode(CursorBoxNode)
    node.options({ x: 20, y: 20, width: 120, height: 80, cursor: 'pointer', interactive: true })

    app.cursors.syncPointer({ x: 40, y: 40, target: node })
    expect(app.cursors.lastSource).toBe(node)

    vi.spyOn(node, 'getRenderBounds').mockReturnValue({ x: 800, y: 800, width: 10, height: 10 })
    app.cursors.markSpatialDirty(node)
    app.cursors.syncPointer({ x: 44, y: 44, target: null })

    expect(app.cursors.lastSource).toBe(node)
    expect(app.canvas.element.style.cursor).toBe('pointer')

    app.destroy()
  })

  it('reuses component cursor nodes per effective component signature', () => {
    const app = createApp()
    const surface = app.createSurface('cursor')
    app.schema.register(TEST_CURSOR_DESCRIPTOR)

    const node = surface.createNode(CursorBoxNode)
    node.options({
      x: 20,
      y: 20,
      width: 120,
      height: 80,
      interactive: true,
      cursor: {
        hover: { type: 'component', component: 'test.cursor', props: { active: true }, hotspot: { x: 4, y: 4 } },
      },
    })

    app.cursors.syncPointer({ x: 40, y: 40, target: node })
    app.cursors.syncPointer({ x: 44, y: 44, target: node })

    expect(componentCreateCount).toBe(1)
    expect(app.canvas.element.style.cursor).toBe('none')

    app.destroy()
  })

  it('marks component cursor overlay dirty when pointer leaves component cursor source', () => {
    const app = createApp()
    const surface = app.createSurface('cursor')
    app.schema.register(TEST_CURSOR_DESCRIPTOR)

    const node = surface.createNode(CursorBoxNode)
    node.options({
      x: 20,
      y: 20,
      width: 120,
      height: 80,
      interactive: true,
      cursor: {
        hover: { type: 'component', component: 'test.cursor', props: { active: true } },
      },
    })

    app.cursors.syncPointer({ x: 40, y: 40, target: node })

    const overlay = app.surfaces.find(item => item.name === 'nova-cursor-overlay')
    const cursorNode = overlay?.children[0] as NovaNode<TestEvents> | undefined

    expect(cursorNode?.localVisible).toBe(true)

    app.cursors.syncPointer({ x: 200, y: 200, target: null })

    expect(cursorNode?.localVisible).toBe(false)
    expect(app.canvas.element.style.cursor).toBe('default')

    app.destroy()
  })

  it('resets cursor on canvas leave and destroys cursor overlay state', () => {
    const app = createApp(true)
    const surface = app.createSurface('cursor')
    app.schema.register(TEST_CURSOR_DESCRIPTOR)
    const node = surface.createNode(CursorBoxNode)
    node.options({
      x: 20,
      y: 20,
      width: 120,
      height: 80,
      interactive: true,
      cursor: {
        hover: { type: 'component', component: 'test.cursor', props: { active: true } },
      },
    })

    app.cursors.syncPointer({ x: 40, y: 40, target: node })
    expect(app.canvas.element.style.cursor).toBe('none')

    dispatchMouse(app.canvas.element, 'mouseleave', 900, 900)
    expect(app.canvas.element.style.cursor).toBe('default')

    app.destroy()
    expect(app.cursors.cursorNodes.size).toBe(0)
  })

  it('keeps legacy app.cursor native setter compatible', () => {
    const app = createApp()

    app.cursor('pointer')

    expect(app.canvas.element.style.cursor).toBe('pointer')

    app.destroy()
  })
})
