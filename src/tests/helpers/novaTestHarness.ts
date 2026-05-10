import { vi } from 'vitest'
import {
  Nova,
  RaphSchedulerType,
  RendererType,
  type NovaApp,
  type NovaRaphOptions,
  type NovaSoundOptions,
} from '@/index'
import type { EventList } from '@endge/utils'

/**
 * Создает mock Canvas2D context для jsdom-тестов Nova.
 */
export function create2DContextStub(): CanvasRenderingContext2D {
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

/**
 * Устанавливает canvas mocks для jsdom-тестов Nova.
 */
export function installCanvasMocks(): void {
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

  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLCanvasElement) {
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

/**
 * Создает canvas element для jsdom-тестов Nova.
 */
export function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return canvas
}

/**
 * Создает тестовый NovaApp с sync scheduler.
 */
export function createTestApp<E extends EventList = Record<string, any>>(
  options: {
    width?: number
    height?: number
    raph?: NovaRaphOptions
    sound?: NovaSoundOptions
  } = {},
): NovaApp<E> {
  return Nova.createApp<E>({
    target: createCanvas(),
    size: {
      width: options.width ?? 320,
      height: options.height ?? 180,
      maxDpr: 2,
    },
    input: {
      pointer: { enabled: false },
      keyboard: { enabled: false, scope: 'manual' },
    },
    renderer: {
      main: RendererType.Web2D,
    },
    scheduler: {
      type: RaphSchedulerType.Sync,
      loop: false,
    },
    raph: options.raph,
    sound: options.sound,
  })
}
