import { describe, expect, it, vi } from 'vitest'
import { Nova, NovaAssetRegistry } from '@/index'
import { NovaRenderer2D } from '@/model/render/backends/canvas2d/NovaRenderer2D'
import type { NovaCanvas } from '@/model/platform/NovaCanvas'

function createContextSpy(): CanvasRenderingContext2D & { calls: Array<string> } {
  const calls: Array<string> = []
  const state: Record<PropertyKey, any> = {
    canvas: document.createElement('canvas'),
    calls,
    setTransform: (...args: Array<number>) => calls.push(`setTransform:${args.join(':')}`),
    clearRect: (...args: Array<number>) => calls.push(`clearRect:${args.join(':')}`),
    scale: (...args: Array<number>) => calls.push(`scale:${args.join(':')}`),
    createPattern: () => {
      calls.push('createPattern')
      return {}
    },
    drawImage: () => {
      calls.push('drawImage')
    },
    createLinearGradient: () => ({
      addColorStop: () => undefined,
    }),
  }

  return new Proxy(state, {
    /**
     * Возвращает значение состояния текущего класса.
     */
    get(target, prop) {
      if (!(prop in target)) {
        target[prop] = () => undefined
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
  }) as CanvasRenderingContext2D & { calls: Array<string> }
}

function createCanvasStub(context: CanvasRenderingContext2D): NovaCanvas {
  return {
    dpr: 2,
    element: document.createElement('canvas'),
    height: 300,
    maxDpr: 2,
    pixelHeight: 600,
    pixelWidth: 800,
    width: 400,
    getContext2D: () => context,
  } as unknown as NovaCanvas
}

describe('NovaRenderer2D', () => {
  it('clears the real pixel buffer without inheriting the previous transform', () => {
    const context = createContextSpy()
    const renderer = new NovaRenderer2D(createCanvasStub(context))

    renderer.clear()

    expect(context.calls).toEqual([
      'setTransform:1:0:0:1:0:0',
      'clearRect:0:0:800:600',
      'scale:2:2',
    ])
  })

  it('draws asset-backed rect fills and icons through the drawable registry', () => {
    const context = createContextSpy()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const registry = new NovaAssetRegistry()
    const canvasAsset = document.createElement('canvas')
    const bundle = Nova.assets.define('renderer-assets', {
      fills: {
        fade: Nova.assets.linearGradient({ from: '#fff', to: '#000' }),
      },
      icons: {
        marker: Nova.assets.canvas(canvasAsset),
      },
    })
    registry.use(bundle)
    const renderer = new NovaRenderer2D(createCanvasStub(context), undefined, registry)

    renderer.rect({
      x: 0,
      y: 0,
      width: 20,
      height: 10,
      styles: { background: bundle.fills.fade },
    })
    renderer.icon({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
      icon: bundle.icons.marker,
    })

    expect(context.calls).toContain('createPattern')
    expect(context.calls).toContain('drawImage')
    getContext.mockRestore()
  })
})
