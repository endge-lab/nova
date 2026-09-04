import { bench, describe, vi } from 'vitest'
import { Nova, NovaAssetRegistry } from '@/index'
import { create2DContextStub } from '@/test/helpers/novaTestHarness'

const benchOptions = {
  iterations: 3,
  warmupIterations: 1,
  time: 10,
  warmupTime: 5,
}

installAssetBenchCanvasMocks()

describe('бенчмарки assets Nova', () => {
  for (const size of [256, 512, 1024]) {
    bench(`materialize procedural fills / ${size}px`, () => {
      const registry = new NovaAssetRegistry()
      const bundle = Nova.assets.define(`asset-bench-${size}`, {
        fills: {
          linear: Nova.assets.linearGradient({ from: '#fff', to: '#000', size }),
          radial: Nova.assets.radialGradient({ inner: '#fff', outer: '#000', size }),
          conic: Nova.assets.conicGradient({ from: '#fff', to: '#000', size }),
          noise: Nova.assets.noise({ size, seed: 42 }),
          mesh: Nova.assets.meshGradient({
            background: '#fff',
            size,
            points: [
              { x: 0.2, y: 0.2, color: '#38bdf8' },
              { x: 0.8, y: 0.5, color: '#a855f7' },
              { x: 0.5, y: 0.9, color: '#22c55e' },
            ],
          }),
        },
      })
      registry.use(bundle)
      registry.resolveDrawable(bundle.fills.linear)
      registry.resolveDrawable(bundle.fills.radial)
      registry.resolveDrawable(bundle.fills.conic)
      registry.resolveDrawable(bundle.fills.noise)
      registry.resolveDrawable(bundle.fills.mesh)
      registry.unuse(bundle)
    }, benchOptions)
  }

  bench('resolve cached asset refs / 100k', () => {
    const registry = new NovaAssetRegistry()
    const bundle = Nova.assets.define('asset-cache-bench', {
      fills: {
        linear: Nova.assets.linearGradient({ from: '#fff', to: '#000' }),
      },
    })
    registry.use(bundle)
    registry.resolveDrawable(bundle.fills.linear)
    for (let index = 0; index < 100_000; index += 1) {
      registry.resolveDrawable(bundle.fills.linear)
    }
  }, benchOptions)

  bench('renderer rect fills / 1k stretch vs repeat', () => {
    const registry = new NovaAssetRegistry()
    const tile = document.createElement('canvas')
    tile.width = 8
    tile.height = 8
    const bundle = Nova.assets.define('asset-render-bench', {
      fills: {
        stretch: Nova.assets.linearGradient({ from: '#fff', to: '#000', size: 256 }),
        repeat: Nova.assets.pattern(tile, { repeat: 'repeat' }),
      },
    })
    registry.use(bundle)
    const stretch = registry.resolveDrawable(bundle.fills.stretch)
    const repeat = registry.resolveDrawable(bundle.fills.repeat)
    if (!stretch || !repeat) {
      throw new Error('bench assets missing')
    }
  }, benchOptions)
})

/**
 * Устанавливает canvas mocks для asset benchmark.
 */
function installAssetBenchCanvasMocks(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type !== '2d') {
      return null
    }
    const context = create2DContextStub() as CanvasRenderingContext2D & Record<PropertyKey, any>
    context.createLinearGradient = vi.fn(() => ({ addColorStop: vi.fn() }))
    context.createRadialGradient = vi.fn(() => ({ addColorStop: vi.fn() }))
    context.createConicGradient = vi.fn(() => ({ addColorStop: vi.fn() }))
    ;(context as Record<PropertyKey, any>).createImageData = vi.fn((width: number, height: number) => ({
      colorSpace: 'srgb',
      data: new Uint8ClampedArray(width * height * 4),
      height,
      width,
    } satisfies ImageData))
    context.putImageData = vi.fn()
    context.drawImage = vi.fn()
    context.clearRect = vi.fn()
    return context
  })
}
