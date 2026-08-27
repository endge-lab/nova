import { describe, expect, it, vi } from 'vitest'
import { isNovaAssetRef, Nova, NovaAssetRegistry } from '@/index'

describe('nova assets registry', () => {
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
    const fontBundle = Nova.assets.define('font-assets', {
      fonts: {
        inter: Nova.assets.font({ family: 'Inter', src: '/fonts/inter.woff2' }),
      },
    })
    expect(fontBundle.fonts.inter.id).toBe('font-assets/fonts/inter')
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

  it('materializes v2 procedural fills synchronously with fill modes', () => {
    const onUpdate = vi.fn()
    const registry = new NovaAssetRegistry(undefined, onUpdate)
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const addColorStop = vi.fn()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createLinearGradient: vi.fn(() => ({ addColorStop })),
      createRadialGradient: vi.fn(() => ({ addColorStop })),
      createConicGradient: vi.fn(() => ({ addColorStop })),
      createImageData: vi.fn((width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) })),
      putImageData: vi.fn(),
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D)
    const bundle = Nova.assets.define('asset-v2-test', {
      fills: {
        radial: Nova.assets.radialGradient({ inner: '#fff', outer: '#000' }),
        conic: Nova.assets.conicGradient({ from: '#fff', to: '#000' }),
        pattern: Nova.assets.pattern(canvas, { repeat: 'repeat-x' }),
        noise: Nova.assets.noise({ seed: 42, size: 4 }),
        mesh: Nova.assets.meshGradient({
          background: '#fff',
          points: [{ x: 0.5, y: 0.5, color: '#2563eb' }],
        }),
      },
      images: {
        panel: Nova.assets.nineSliceImage(canvas, { slice: 2 }),
      },
    })

    registry.use(bundle)

    expect(registry.resolveDrawable(bundle.fills.radial)).toBeInstanceOf(HTMLCanvasElement)
    expect(registry.resolveDrawable(bundle.fills.conic)).toBeInstanceOf(HTMLCanvasElement)
    expect(registry.resolveDrawable(bundle.fills.pattern)).toBeInstanceOf(HTMLCanvasElement)
    expect(registry.resolveDrawable(bundle.fills.noise)).toBeInstanceOf(HTMLCanvasElement)
    expect(registry.resolveDrawable(bundle.fills.mesh)).toBeInstanceOf(HTMLCanvasElement)
    expect(registry.resolveDrawable(bundle.images.panel)).toBe(canvas)
    expect(registry.resolveDrawableFillMode(bundle.fills.radial)).toBe('stretch')
    expect(registry.resolveDrawableFillMode(bundle.fills.pattern)).toBe('repeat-x')
    expect(registry.resolveNineSlice(bundle.images.panel)?.slice.left).toBe(2)
    expect(onUpdate).not.toHaveBeenCalled()
    getContext.mockRestore()
  })

  it('returns an SVG canvas before async image materialization completes', () => {
    const onUpdate = vi.fn()
    const registry = new NovaAssetRegistry(undefined, onUpdate)
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    const previousCreateObjectURL = URL.createObjectURL
    const previousRevokeObjectURL = URL.revokeObjectURL
    const createObjectURL = vi.fn(() => 'blob:nova-svg-test')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
    const bundle = Nova.assets.define('svg-loading-test', {
      icons: {
        moon: Nova.assets.svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3"/></svg>', {
          width: 24,
          height: 24,
          color: '#fff',
        }),
      },
    })

    registry.use(bundle)

    const source = registry.resolveDrawable(bundle.icons.moon)
    expect(source).toBeInstanceOf(HTMLCanvasElement)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalled()
    getContext.mockRestore()
    restoreUrlObjectMethods(previousCreateObjectURL, previousRevokeObjectURL)
  })

  it('uses auto DPR for SVG canvas materialization and caps it at 2', () => {
    const previousDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    const onUpdate = vi.fn()
    const registry = new NovaAssetRegistry(undefined, onUpdate)
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    const previousCreateObjectURL = URL.createObjectURL
    const previousRevokeObjectURL = URL.revokeObjectURL
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:nova-svg-dpr-test'), configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    const bundle = Nova.assets.define('svg-auto-dpr-test', {
      icons: {
        moon: Nova.assets.svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3"/></svg>', {
          width: 24,
          height: 24,
          color: '#fff',
        }),
      },
    })

    registry.use(bundle)

    const source = registry.resolveDrawable(bundle.icons.moon) as HTMLCanvasElement
    expect(source.width).toBe(48)
    expect(source.height).toBe(48)
    expect(onUpdate).not.toHaveBeenCalled()

    getContext.mockRestore()
    restoreUrlObjectMethods(previousCreateObjectURL, previousRevokeObjectURL)
    restoreWindowDevicePixelRatio(previousDpr)
  })

  it('allows explicit SVG pixel ratio override', () => {
    const previousDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
    const registry = new NovaAssetRegistry()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    const previousCreateObjectURL = URL.createObjectURL
    const previousRevokeObjectURL = URL.revokeObjectURL
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:nova-svg-explicit-dpr-test'), configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    const bundle = Nova.assets.define('svg-explicit-dpr-test', {
      icons: {
        moon: Nova.assets.svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3"/></svg>', {
          width: 24,
          height: 24,
          color: '#fff',
          pixelRatio: 1,
        }),
      },
    })

    registry.use(bundle)

    const source = registry.resolveDrawable(bundle.icons.moon) as HTMLCanvasElement
    expect(source.width).toBe(24)
    expect(source.height).toBe(24)

    getContext.mockRestore()
    restoreUrlObjectMethods(previousCreateObjectURL, previousRevokeObjectURL)
    restoreWindowDevicePixelRatio(previousDpr)
  })

  it('bumps drawable key when an async SVG asset becomes ready', () => {
    const onUpdate = vi.fn()
    const registry = new NovaAssetRegistry(undefined, onUpdate)
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    const previousCreateObjectURL = URL.createObjectURL
    const previousRevokeObjectURL = URL.revokeObjectURL
    const createObjectURL = vi.fn(() => 'blob:nova-svg-version-test')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
    const previousImage = globalThis.Image
    let image: { onload?: () => void } | undefined
    vi.stubGlobal('Image', class {
      onload?: () => void
      onerror?: () => void
      set src(_value: string) {}
      /**
       * Создает тестовый Image stub.
       */
      constructor() {
        image = this
      }
    })
    const bundle = Nova.assets.define('svg-key-version-test', {
      icons: {
        moon: Nova.assets.svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3"/></svg>', {
          width: 24,
          height: 24,
          color: '#fff',
        }),
      },
    })

    registry.use(bundle)

    registry.resolveDrawable(bundle.icons.moon)
    expect(registry.resolveDrawableKey('icon', bundle.icons.moon, () => 'inline')).toBe('icon:svg-key-version-test/icons/moon:v0')
    image?.onload?.()
    expect(registry.resolveDrawableKey('icon', bundle.icons.moon, () => 'inline')).toBe('icon:svg-key-version-test/icons/moon:v1')
    expect(onUpdate).toHaveBeenCalledTimes(1)

    vi.stubGlobal('Image', previousImage)
    getContext.mockRestore()
    restoreUrlObjectMethods(previousCreateObjectURL, previousRevokeObjectURL)
  })

  it('loads and removes font assets through document fonts', async () => {
    const onUpdate = vi.fn()
    const load = vi.fn()
    const add = vi.fn()
    const remove = vi.fn()
    class FontFaceStub {
      /**
       * Создает тестовый FontFaceStub.
       */
      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors: FontFaceDescriptors,
      ) {}

      /**
       * Загружает тестовый font face.
       */
      load(): Promise<FontFace> {
        load()
        return Promise.resolve(this as unknown as FontFace)
      }
    }
    vi.stubGlobal('FontFace', FontFaceStub)
    Object.defineProperty(document, 'fonts', {
      value: { add, delete: remove },
      configurable: true,
    })
    const registry = new NovaAssetRegistry(undefined, onUpdate)
    const bundle = Nova.assets.define('font-load-test', {
      fonts: {
        display: Nova.assets.font({ family: 'Display', src: '/display.woff2', weight: '700' }),
      },
    })

    registry.use(bundle)
    expect(registry.resolve(bundle.fonts.display)?.ready).toBe(false)
    await Promise.resolve()

    expect(load).toHaveBeenCalled()
    expect(add).toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalled()

    registry.unuse(bundle)
    expect(remove).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

function restoreUrlObjectMethods(
  createObjectURL: typeof URL.createObjectURL | undefined,
  revokeObjectURL: typeof URL.revokeObjectURL | undefined,
): void {
  if (createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
  }
  else { delete (URL as Partial<typeof URL>).createObjectURL }
  if (revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
  }
  else { delete (URL as Partial<typeof URL>).revokeObjectURL }
}

function restoreWindowDevicePixelRatio(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(window, 'devicePixelRatio', descriptor)
  }
  else { delete (window as Partial<Window>).devicePixelRatio }
}
