import type { EventList } from '@endge/utils'
import type { NovaApp, NovaSurface } from '@/index'
import type { NovaCanvas } from '@/model/platform/NovaCanvas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NovaNode } from '@/index'
import { NovaRenderBuilder } from '@/model/render/compiler/NovaRenderBuilder'
import { NovaRenderCommandWriter } from '@/model/render/compiler/NovaRenderCommandWriter'
import { NovaRenderFrameBuilder } from '@/model/render/compiler/NovaRenderFrameBuilder'
import { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import { create2DContextStub, createTestApp, installCanvasMocks } from '@/test/helpers/novaTestHarness'

type TestEvents = EventList

class LeakyClipNode extends NovaNode<TestEvents> {
  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface)
  }

  override render(): void {
    this.renderer.clip(0, 0, 20, 20)
    this.renderer.rect({
      type: 'rect',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      styles: { background: '#ff0000' },
    })
  }
}

class PlainRectNode extends NovaNode<TestEvents> {
  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface)
  }

  override render(): void {
    this.renderer.rect({
      type: 'rect',
      x: 24,
      y: 0,
      width: 10,
      height: 10,
      styles: { background: '#0000ff' },
    })
  }
}

function createCanvasStub(): NovaCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = 200
  canvas.height = 100

  return {
    dpr: 1,
    element: canvas,
    height: 100,
    maxDpr: 1,
    pixelHeight: 100,
    pixelWidth: 200,
    width: 200,
    getContext2D: () => create2DContextStub(),
    getContextWebGL: () => null as unknown as WebGLRenderingContext,
  } as unknown as NovaCanvas
}

function createFrameBuilder(): NovaRenderFrameBuilder {
  return new NovaRenderFrameBuilder('state-boundary', {
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    dpr: 1,
  })
}

describe('границы состояния render Nova', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('восстанавливает утёкшее состояние clip и transform до сохранённой границы', () => {
    const frameBuilder = createFrameBuilder()
    const writer = new NovaRenderCommandWriter(frameBuilder)
    const builder = new NovaRenderBuilder(createCanvasStub(), new NovaSchemaRegistry(), writer)

    builder.save()
    const mark = builder.markState()
    builder.clip(0, 0, 10, 10)
    builder.save()
    builder.rect({ type: 'rect', x: 0, y: 0, width: 1, height: 1, styles: { background: '#fff' } })
    builder.restoreState(mark)
    builder.restore()

    expect(frameBuilder.build().commands.map(command => command.type)).toEqual([
      'save',
      'clip',
      'save',
      'drawItem',
      'clearClip',
      'restore',
      'restore',
    ])
  })

  it('не позволяет дочернему scope очищать состояние clip родителя', () => {
    const frameBuilder = createFrameBuilder()
    const writer = new NovaRenderCommandWriter(frameBuilder)
    const builder = new NovaRenderBuilder(createCanvasStub(), new NovaSchemaRegistry(), writer)

    builder.clip(0, 0, 20, 20)
    const childMark = builder.markState()
    builder.clearClip()
    builder.restoreState(childMark)
    builder.clearClip()

    expect(frameBuilder.build().commands.map(command => command.type)).toEqual(['clip', 'clearClip'])
  })

  it('не позволяет утечке clip узла влиять на последующие соседние элементы render', () => {
    const app = createTestApp<TestEvents>()
    const surface = app.createSurface('state-boundary')
    surface.createNode(LeakyClipNode)
    surface.createNode(PlainRectNode)
    app.raph.run()

    const frame = surface.compileRenderFrame()
    const leakyItem = frame.items.find(item => item.schemaItem?.type === 'rect' && item.schemaItem.styles?.background === '#ff0000')
    const siblingItem = frame.items.find(item => item.schemaItem?.type === 'rect' && item.schemaItem.styles?.background === '#0000ff')

    expect(leakyItem?.clip).toMatchObject({ x: 0, y: 0, width: 20, height: 20 })
    expect(siblingItem?.clip).toBeNull()
  })
})
