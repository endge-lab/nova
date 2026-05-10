import { describe, expect, it } from 'vitest'
import { NovaRenderer2D } from '@/model/render/backends/canvas2d/NovaRenderer2D'
import type { NovaCanvas } from '@/model/infrastructure/canvas/NovaCanvas'

function createContextSpy(): CanvasRenderingContext2D & { calls: string[] } {
  const calls: string[] = []
  const state: Record<PropertyKey, any> = {
    canvas: document.createElement('canvas'),
    calls,
    setTransform: (...args: number[]) => calls.push(`setTransform:${args.join(':')}`),
    clearRect: (...args: number[]) => calls.push(`clearRect:${args.join(':')}`),
    scale: (...args: number[]) => calls.push(`scale:${args.join(':')}`),
  }

  return new Proxy(state, {
    get(target, prop) {
      if (!(prop in target)) {
        target[prop] = () => undefined
      }
      return target[prop]
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  }) as CanvasRenderingContext2D & { calls: string[] }
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
})
