import { describe, expect, it, vi } from 'vitest'
import { Nova, NovaAssetRegistry, isNovaAssetRef } from '@/index'

describe('Nova assets registry', () => {
  it('creates deterministic refs for scoped assets', () => {
    const bundle = Nova.assets.define('test-assets', {
      icons: {
        warning: Nova.assets.canvas(document.createElement('canvas')),
      },
      fills: {
        stripe: Nova.assets.stripe({
          bgColor: '#fff7ed',
          stripeColor: '#fb923c',
          stripeWidth: 2,
        }),
      },
    })

    expect(isNovaAssetRef(bundle.icons.warning)).toBe(true)
    expect(bundle.icons.warning.id).toBe('test-assets/icons/warning')
    expect(bundle.fills.stripe.id).toBe('test-assets/fills/stripe')
  })

  it('resolves child scope before global parent', () => {
    const parentCanvas = document.createElement('canvas')
    const childCanvas = document.createElement('canvas')
    const globalBundle = Nova.assets.define('scope-test', {
      icons: {
        same: Nova.assets.canvas(parentCanvas),
      },
    })
    const childBundle = Nova.assets.define('scope-test', {
      icons: {
        same: Nova.assets.canvas(childCanvas),
      },
    })
    const parent = new NovaAssetRegistry()
    const child = new NovaAssetRegistry(parent)

    parent.use(globalBundle)
    child.use(childBundle)

    expect(parent.resolveDrawable(globalBundle.icons.same)).toBe(parentCanvas)
    expect(child.resolveDrawable(childBundle.icons.same)).toBe(childCanvas)
  })

  it('keeps shared scoped assets until the last unuse', () => {
    const canvas = document.createElement('canvas')
    const bundle = Nova.assets.define('shared-scope-test', {
      icons: {
        same: Nova.assets.canvas(canvas),
      },
    })
    const registry = new NovaAssetRegistry()

    registry.use(bundle)
    registry.use(bundle)
    registry.unuse(bundle)

    expect(registry.resolveDrawable(bundle.icons.same)).toBe(canvas)

    registry.unuse(bundle)

    expect(registry.resolveDrawable(bundle.icons.same)).toBeUndefined()
  })

  it('materializes stripe fills synchronously', () => {
    const onUpdate = vi.fn()
    const registry = new NovaAssetRegistry(undefined, onUpdate)
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D)
    const bundle = Nova.assets.define('stripe-test', {
      fills: {
        breakStripe: Nova.assets.stripe({
          bgColor: '#fdf1cd',
          stripeColor: '#8fb7e7',
          stripeWidth: 3,
          angle: 45,
        }),
      },
    })

    registry.use(bundle)
    const source = registry.resolveDrawable(bundle.fills.breakStripe)

    expect(source).toBeInstanceOf(HTMLCanvasElement)
    expect(onUpdate).not.toHaveBeenCalled()
    getContext.mockRestore()
  })

  it('materializes linear gradient fills synchronously', () => {
    const onUpdate = vi.fn()
    const registry = new NovaAssetRegistry(undefined, onUpdate)
    const addColorStop = vi.fn()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createLinearGradient: vi.fn(() => ({ addColorStop })),
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D)
    const bundle = Nova.assets.define('gradient-test', {
      fills: {
        fade: Nova.assets.linearGradient({
          from: '#ffffff',
          to: 'rgba(255,255,255,0)',
          angle: 90,
        }),
      },
    })

    registry.use(bundle)
    const source = registry.resolveDrawable(bundle.fills.fade)

    expect(source).toBeInstanceOf(HTMLCanvasElement)
    expect(addColorStop).toHaveBeenCalledWith(0, '#ffffff')
    expect(addColorStop).toHaveBeenCalledWith(1, 'rgba(255,255,255,0)')
    expect(onUpdate).not.toHaveBeenCalled()
    getContext.mockRestore()
  })
})
