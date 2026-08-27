/**
 * Описывает kind Nova asset.
 */
export type NovaAssetKind = 'icon' | 'image' | 'fill' | 'font'

/**
 * Описывает режим заполнения drawable asset внутри rect.
 */
export type NovaAssetFillMode = 'stretch' | 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat'

/**
 * Описывает сторону nine-slice bitmap.
 */
export interface NovaNineSliceInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/**
 * Описывает ref на asset без раскрытия atlas/texture деталей.
 */
export interface NovaAssetRef<K extends NovaAssetKind = NovaAssetKind> {
  readonly __novaAssetRef: true
  readonly namespace: string
  readonly kind: K
  readonly name: string
  readonly id: string
}

/**
 * Описывает SVG asset descriptor.
 */
export interface NovaSvgAssetDescriptor {
  readonly type: 'svg'
  readonly source: string
  readonly width: number
  readonly height: number
  readonly color?: string
  readonly pixelRatio?: NovaSvgAssetPixelRatio
}

export type NovaSvgAssetPixelRatio = number | 'auto'

/**
 * Описывает image asset descriptor.
 */
export interface NovaImageAssetDescriptor {
  readonly type: 'image'
  readonly source: CanvasImageSource | string
  readonly width?: number
  readonly height?: number
}

/**
 * Описывает canvas asset descriptor.
 */
export interface NovaCanvasAssetDescriptor {
  readonly type: 'canvas'
  readonly source: HTMLCanvasElement | OffscreenCanvas
  readonly width?: number
  readonly height?: number
}

/**
 * Описывает pattern fill descriptor.
 */
export interface NovaPatternAssetDescriptor {
  readonly type: 'pattern'
  readonly source: CanvasImageSource | string
  readonly repeat: Exclude<NovaAssetFillMode, 'stretch'>
  readonly width?: number
  readonly height?: number
  readonly scale?: number
  readonly offsetX?: number
  readonly offsetY?: number
}

/**
 * Описывает stripe fill descriptor.
 */
export interface NovaStripeAssetDescriptor {
  readonly type: 'stripe'
  readonly bgColor: string
  readonly stripeColor: string
  readonly stripeWidth: number
  readonly angle: number
  readonly sizeK: number
}

/**
 * Описывает stop gradient fill descriptor.
 */
export interface NovaGradientStop {
  readonly offset: number
  readonly color: string
}

/**
 * Описывает stop linear-gradient fill descriptor.
 */
export type NovaLinearGradientStop = NovaGradientStop

/**
 * Описывает linear-gradient fill descriptor.
 */
export interface NovaLinearGradientAssetDescriptor {
  readonly type: 'linear-gradient'
  readonly from: string
  readonly to: string
  readonly angle: number
  readonly stops?: ReadonlyArray<NovaLinearGradientStop>
  readonly size?: number
}

/**
 * Описывает radial-gradient fill descriptor.
 */
export interface NovaRadialGradientAssetDescriptor {
  readonly type: 'radial-gradient'
  readonly inner: string
  readonly outer: string
  readonly centerX: number
  readonly centerY: number
  readonly radiusX: number
  readonly radiusY: number
  readonly stops?: ReadonlyArray<NovaGradientStop>
  readonly size?: number
}

/**
 * Описывает conic-gradient fill descriptor.
 */
export interface NovaConicGradientAssetDescriptor {
  readonly type: 'conic-gradient'
  readonly from: string
  readonly to: string
  readonly centerX: number
  readonly centerY: number
  readonly startAngle: number
  readonly stops?: ReadonlyArray<NovaGradientStop>
  readonly size?: number
}

/**
 * Описывает noise fill descriptor.
 */
export interface NovaNoiseAssetDescriptor {
  readonly type: 'noise'
  readonly baseColor: string
  readonly noiseColor: string
  readonly opacity: number
  readonly density: number
  readonly seed: number
  readonly size?: number
}

/**
 * Описывает точку mesh-gradient.
 */
export interface NovaMeshGradientPoint {
  readonly x: number
  readonly y: number
  readonly color: string
  readonly radius?: number
  readonly opacity?: number
}

/**
 * Описывает mesh-gradient fill descriptor.
 */
export interface NovaMeshGradientAssetDescriptor {
  readonly type: 'mesh-gradient'
  readonly background: string
  readonly points: ReadonlyArray<NovaMeshGradientPoint>
  readonly size?: number
}

/**
 * Описывает nine-slice image descriptor.
 */
export interface NovaNineSliceImageAssetDescriptor {
  readonly type: 'nine-slice-image'
  readonly source: CanvasImageSource | string
  readonly slice: NovaNineSliceInsets
  readonly width?: number
  readonly height?: number
  readonly centerMode: 'stretch' | 'repeat'
}

/**
 * Описывает font descriptor.
 */
export interface NovaFontAssetDescriptor {
  readonly type: 'font'
  readonly family: string
  readonly src: string
  readonly weight?: string
  readonly style?: string
  readonly display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional'
}

/**
 * Описывает asset descriptor.
 */
export type NovaAssetDescriptor
  = | NovaSvgAssetDescriptor
    | NovaImageAssetDescriptor
    | NovaCanvasAssetDescriptor
    | NovaPatternAssetDescriptor
    | NovaStripeAssetDescriptor
    | NovaLinearGradientAssetDescriptor
    | NovaRadialGradientAssetDescriptor
    | NovaConicGradientAssetDescriptor
    | NovaNoiseAssetDescriptor
    | NovaMeshGradientAssetDescriptor
    | NovaNineSliceImageAssetDescriptor
    | NovaFontAssetDescriptor

/**
 * Описывает input bundle assets.
 */
export interface NovaAssetBundleInput {
  readonly icons?: Record<string, NovaAssetDescriptor>
  readonly images?: Record<string, NovaAssetDescriptor>
  readonly fills?: Record<string, NovaAssetDescriptor>
  readonly fonts?: Record<string, NovaAssetDescriptor>
}

/**
 * Описывает нормализованный asset record.
 */
export interface NovaAssetRecord<K extends NovaAssetKind = NovaAssetKind> {
  readonly ref: NovaAssetRef<K>
  readonly descriptor: NovaAssetDescriptor
}

/**
 * Описывает bundle с typed refs.
 */
export interface NovaAssetBundle<
  I extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>,
  F extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>,
  M extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>,
  T extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>,
> {
  readonly namespace: string
  readonly icons: { readonly [K in keyof I]: NovaAssetRef<'icon'> }
  readonly fills: { readonly [K in keyof F]: NovaAssetRef<'fill'> }
  readonly images: { readonly [K in keyof M]: NovaAssetRef<'image'> }
  readonly fonts: { readonly [K in keyof T]: NovaAssetRef<'font'> }
  readonly records: ReadonlyMap<string, NovaAssetRecord>
}

/**
 * Описывает resolved drawable asset.
 */
export interface NovaResolvedAsset<K extends NovaAssetKind = NovaAssetKind> {
  readonly ref: NovaAssetRef<K>
  readonly descriptor: NovaAssetDescriptor
  readonly source?: CanvasImageSource
  readonly ready: boolean
}

/**
 * Описывает drawable asset input.
 */
export type NovaAssetDrawableInput = NovaAssetRef | CanvasImageSource | string | undefined | null

interface AssetMaterialization {
  source?: CanvasImageSource
  ready: boolean
  loading?: boolean
  version?: number
  loader?: HTMLImageElement
}

interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Проверяет ref Nova asset.
 */
export function isNovaAssetRef(value: unknown): value is NovaAssetRef {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as NovaAssetRef).__novaAssetRef === true
    && typeof (value as NovaAssetRef).id === 'string',
  )
}

/**
 * Управляет scoped/global Nova assets без exposing atlas internals.
 */
export class NovaAssetRegistry {
  private readonly _records = new Map<string, NovaAssetRecord>()
  private readonly _materialized = new Map<string, AssetMaterialization>()
  private readonly _recordUseCounts = new Map<string, number>()
  private readonly _fontFaces = new Map<string, FontFace>()

  /**
   * Создает registry.
   */
  constructor(
    private readonly _parent?: NovaAssetRegistry,
    private readonly _onUpdate?: () => void,
  ) {}

  /**
   * Подключает bundle в текущий scope.
   */
  use(bundle: NovaAssetBundle): void {
    for (const [id, record] of bundle.records) {
      this._recordUseCounts.set(id, (this._recordUseCounts.get(id) ?? 0) + 1)
      this._records.set(id, record)
    }
  }

  /**
   * Удаляет bundle из текущего scope.
   */
  unuse(bundle: NovaAssetBundle): void {
    for (const id of bundle.records.keys()) {
      const nextCount = (this._recordUseCounts.get(id) ?? 0) - 1
      if (nextCount > 0) {
        this._recordUseCounts.set(id, nextCount)
        continue
      }
      this._recordUseCounts.delete(id)
      this._unuseFontFace(id)
      this._records.delete(id)
      this._materialized.delete(id)
    }
  }

  /**
   * Возвращает asset record по ref или id.
   */
  resolveRecord(input: NovaAssetRef | string | undefined | null): NovaAssetRecord | undefined {
    if (!input) {
      return undefined
    }
    const id = isNovaAssetRef(input) ? input.id : input
    return this._records.get(id) ?? this._parent?.resolveRecord(id)
  }

  /**
   * Возвращает resolved asset.
   */
  resolve(input: NovaAssetRef | string | undefined | null): NovaResolvedAsset | undefined {
    const record = this.resolveRecord(input)
    if (!record) {
      return undefined
    }

    const materialized = this._resolveMaterialization(record)
    return {
      ref: record.ref,
      descriptor: record.descriptor,
      source: materialized.source,
      ready: materialized.ready,
    }
  }

  /**
   * Возвращает drawable source для ref/source.
   */
  resolveDrawable(input: NovaAssetDrawableInput): CanvasImageSource | undefined {
    if (!input) {
      return undefined
    }
    if (typeof input === 'string' || isNovaAssetRef(input)) {
      return this.resolve(input)?.source
    }
    return input
  }

  /**
   * Возвращает fill mode для drawable asset.
   */
  resolveDrawableFillMode(input: NovaAssetDrawableInput): NovaAssetFillMode {
    if (!input || !(typeof input === 'string' || isNovaAssetRef(input))) {
      return 'repeat'
    }
    const descriptor = this.resolveRecord(input)?.descriptor
    if (!descriptor) {
      return 'repeat'
    }
    return resolveNovaAssetFillMode(descriptor)
  }

  /**
   * Возвращает stable slice metadata для nine-slice image.
   */
  resolveNineSlice(input: NovaAssetRef<'image'> | string | undefined | null): NovaNineSliceImageAssetDescriptor | undefined {
    const descriptor = this.resolveRecord(input)?.descriptor
    return descriptor?.type === 'nine-slice-image' ? descriptor : undefined
  }

  /**
   * Возвращает стабильный drawable key.
   */
  resolveDrawableKey(prefix: string, input: NovaAssetDrawableInput, fallback: (source: CanvasImageSource) => string): string {
    if (typeof input === 'string' || isNovaAssetRef(input)) {
      const id = isNovaAssetRef(input) ? input.id : input
      const record = this.resolveRecord(input)
      if (!record) {
        return `${prefix}:${id}`
      }
      return `${prefix}:${id}:v${this._resolveMaterializationVersion(record)}`
    }
    if (input) {
      return `${prefix}:${fallback(input)}`
    }
    return `${prefix}:missing`
  }

  /**
   * Возвращает materialized asset.
   */
  private _resolveMaterialization(record: NovaAssetRecord): AssetMaterialization {
    const cached = this._materialized.get(record.ref.id)
    if (cached) {
      return cached
    }

    const descriptor = record.descriptor
    let materialized: AssetMaterialization

    switch (descriptor.type) {
      case 'canvas':
        materialized = {
          source: descriptor.source as CanvasImageSource,
          ready: true,
        }
        break
      case 'stripe':
        materialized = {
          source: this._createStripeCanvas(descriptor),
          ready: true,
        }
        break
      case 'pattern':
        materialized = this._createPatternMaterialization(record, descriptor)
        break
      case 'linear-gradient':
        materialized = {
          source: this._createLinearGradientCanvas(descriptor),
          ready: true,
        }
        break
      case 'radial-gradient':
        materialized = {
          source: this._createRadialGradientCanvas(descriptor),
          ready: true,
        }
        break
      case 'conic-gradient':
        materialized = {
          source: this._createConicGradientCanvas(descriptor),
          ready: true,
        }
        break
      case 'noise':
        materialized = {
          source: this._createNoiseCanvas(descriptor),
          ready: true,
        }
        break
      case 'mesh-gradient':
        materialized = {
          source: this._createMeshGradientCanvas(descriptor),
          ready: true,
        }
        break
      case 'nine-slice-image':
        materialized = this._createNineSliceMaterialization(record, descriptor)
        break
      case 'font':
        materialized = this._createFontMaterialization(record, descriptor)
        break
      case 'image':
        materialized = this._createImageMaterialization(record, descriptor)
        break
      case 'svg':
        materialized = this._createSvgMaterialization(record, descriptor)
        break
      default:
        materialized = { ready: false }
        break
    }

    this._materialized.set(record.ref.id, materialized)
    return materialized
  }

  /**
   * Возвращает версию materialized source для invalidation texture caches.
   */
  private _resolveMaterializationVersion(record: NovaAssetRecord): number {
    return this._materialized.get(record.ref.id)?.version ?? 0
  }

  /**
   * Создает canvas с stripe fill.
   */
  private _createStripeCanvas(descriptor: NovaStripeAssetDescriptor): HTMLCanvasElement {
    const stripeWidth = Math.max(1, descriptor.stripeWidth)
    const patternSize = Math.ceil(Math.sqrt(2) * stripeWidth * Math.max(2, descriptor.sizeK))
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = patternSize
    canvas.height = patternSize

    if (!ctx) {
      return canvas
    }

    ctx.fillStyle = descriptor.bgColor
    ctx.fillRect(0, 0, patternSize, patternSize)
    ctx.translate(patternSize / 2, patternSize / 2)
    ctx.rotate((descriptor.angle * Math.PI) / 180)
    ctx.translate(-patternSize / 2, -patternSize / 2)
    ctx.fillStyle = descriptor.stripeColor

    for (let x = -patternSize; x < patternSize * 2; x += stripeWidth * 2) {
      ctx.fillRect(x, 0, stripeWidth, patternSize * 2)
    }

    return canvas
  }

  /**
   * Создает canvas с linear-gradient fill.
   */
  private _createLinearGradientCanvas(descriptor: NovaLinearGradientAssetDescriptor): HTMLCanvasElement {
    const size = Math.max(2, Math.ceil(descriptor.size ?? 256))
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = size
    canvas.height = size

    if (!ctx) {
      return canvas
    }

    const angle = (descriptor.angle * Math.PI) / 180
    const radius = Math.sqrt(2) * size / 2
    const cx = size / 2
    const cy = size / 2
    const dx = Math.cos(angle) * radius
    const dy = Math.sin(angle) * radius
    const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
    const stops = normalizeGradientStops(descriptor.stops, descriptor.from, descriptor.to)

    for (const stop of stops) {
      gradient.addColorStop(stop.offset, stop.color)
    }

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    return canvas
  }

  /**
   * Создает canvas с radial-gradient fill.
   */
  private _createRadialGradientCanvas(descriptor: NovaRadialGradientAssetDescriptor): HTMLCanvasElement {
    const size = Math.max(2, Math.ceil(descriptor.size ?? 256))
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = size
    canvas.height = size

    if (!ctx) {
      return canvas
    }

    const cx = descriptor.centerX * size
    const cy = descriptor.centerY * size
    const radiusX = Math.max(1, descriptor.radiusX * size)
    const radiusY = Math.max(1, descriptor.radiusY * size)
    const radius = Math.max(radiusX, radiusY)
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    const stops = normalizeGradientStops(descriptor.stops, descriptor.inner, descriptor.outer)

    for (const stop of stops) {
      gradient.addColorStop(stop.offset, stop.color)
    }

    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(radiusX / radius, radiusY / radius)
    ctx.translate(-cx, -cy)
    ctx.fillStyle = gradient
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
    ctx.restore()
    return canvas
  }

  /**
   * Создает canvas с conic-gradient fill.
   */
  private _createConicGradientCanvas(descriptor: NovaConicGradientAssetDescriptor): HTMLCanvasElement {
    const size = Math.max(2, Math.ceil(descriptor.size ?? 256))
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = size
    canvas.height = size

    if (!ctx) {
      return canvas
    }

    const cx = descriptor.centerX * size
    const cy = descriptor.centerY * size
    const stops = normalizeGradientStops(descriptor.stops, descriptor.from, descriptor.to)
    if ('createConicGradient' in ctx && typeof ctx.createConicGradient === 'function') {
      const gradient = ctx.createConicGradient((descriptor.startAngle * Math.PI) / 180, cx, cy)
      for (const stop of stops) {
        gradient.addColorStop(stop.offset, stop.color)
      }
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)
      return canvas
    }

    const image = ctx.createImageData(size, size)
    const startRadians = (descriptor.startAngle * Math.PI) / 180
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const angle = Math.atan2(y - cy, x - cx)
        const offset = positiveModulo((angle - startRadians) / (Math.PI * 2), 1)
        const color = sampleGradientStops(stops, offset)
        const index = (y * size + x) * 4
        image.data[index] = color.r
        image.data[index + 1] = color.g
        image.data[index + 2] = color.b
        image.data[index + 3] = color.a
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  /**
   * Создает canvas с procedural noise fill.
   */
  private _createNoiseCanvas(descriptor: NovaNoiseAssetDescriptor): HTMLCanvasElement {
    const size = Math.max(2, Math.ceil(descriptor.size ?? 256))
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = size
    canvas.height = size

    if (!ctx) {
      return canvas
    }

    const base = parseAssetColor(descriptor.baseColor)
    const noise = parseAssetColor(descriptor.noiseColor)
    const opacity = clamp01(descriptor.opacity)
    const density = clamp01(descriptor.density)
    const image = ctx.createImageData(size, size)
    let seed = descriptor.seed || 1

    for (let index = 0; index < image.data.length; index += 4) {
      seed = seededRandom(seed)
      const random = seed / 0x7FFFFFFF
      const mix = random < density ? opacity * random : 0
      image.data[index] = mixChannel(base.r, noise.r, mix)
      image.data[index + 1] = mixChannel(base.g, noise.g, mix)
      image.data[index + 2] = mixChannel(base.b, noise.b, mix)
      image.data[index + 3] = mixChannel(base.a, noise.a, mix)
    }

    ctx.putImageData(image, 0, 0)
    return canvas
  }

  /**
   * Создает canvas с mesh-gradient fill.
   */
  private _createMeshGradientCanvas(descriptor: NovaMeshGradientAssetDescriptor): HTMLCanvasElement {
    const size = Math.max(2, Math.ceil(descriptor.size ?? 256))
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = size
    canvas.height = size

    if (!ctx) {
      return canvas
    }

    ctx.fillStyle = descriptor.background
    ctx.fillRect(0, 0, size, size)
    for (const point of descriptor.points) {
      const x = point.x * size
      const y = point.y * size
      const radius = Math.max(1, (point.radius ?? 0.45) * size)
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
      const alpha = clamp01(point.opacity ?? 1)
      gradient.addColorStop(0, withAlpha(point.color, alpha))
      gradient.addColorStop(1, withAlpha(point.color, 0))
      ctx.fillStyle = gradient
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    }
    return canvas
  }

  /**
   * Создает materialization для image asset.
   */
  private _createImageMaterialization(record: NovaAssetRecord, descriptor: NovaImageAssetDescriptor): AssetMaterialization {
    return this._createImageBackedMaterialization(record, descriptor.source, source => source)
  }

  /**
   * Создает materialization для pattern fill.
   */
  private _createPatternMaterialization(record: NovaAssetRecord, descriptor: NovaPatternAssetDescriptor): AssetMaterialization {
    return this._createImageBackedMaterialization(record, descriptor.source, source => this._createPatternCanvas(source, descriptor))
  }

  /**
   * Создает materialization для nine-slice image.
   */
  private _createNineSliceMaterialization(record: NovaAssetRecord, descriptor: NovaNineSliceImageAssetDescriptor): AssetMaterialization {
    return this._createImageBackedMaterialization(record, descriptor.source, source => source)
  }

  /**
   * Создает materialization для font asset.
   */
  private _createFontMaterialization(record: NovaAssetRecord, descriptor: NovaFontAssetDescriptor): AssetMaterialization {
    const materialized: AssetMaterialization = { ready: false, loading: true }
    const FontFaceCtor = globalThis.FontFace
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined

    if (!FontFaceCtor || !fonts) {
      materialized.ready = true
      materialized.loading = false
      return materialized
    }

    const face = new FontFaceCtor(descriptor.family, `url(${descriptor.src})`, {
      weight: descriptor.weight,
      style: descriptor.style,
      display: descriptor.display,
    })
    this._fontFaces.set(record.ref.id, face)
    face.load()
      .then((loaded) => {
        fonts.add(loaded)
        materialized.ready = true
        materialized.loading = false
        this._onUpdate?.()
      })
      .catch(() => {
        materialized.loading = false
        this._onUpdate?.()
      })
    this._materialized.set(record.ref.id, materialized)
    return materialized
  }

  /**
   * Создает materialization для SVG asset.
   */
  private _createSvgMaterialization(record: NovaAssetRecord, descriptor: NovaSvgAssetDescriptor): AssetMaterialization {
    const materialized: AssetMaterialization = { ready: false, loading: true }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const pixelRatio = resolveSvgAssetPixelRatio(descriptor.pixelRatio)
    canvas.width = Math.max(1, Math.ceil(descriptor.width * pixelRatio))
    canvas.height = Math.max(1, Math.ceil(descriptor.height * pixelRatio))

    if (!ctx) {
      materialized.source = canvas
      materialized.ready = true
      materialized.loading = false
      return materialized
    }

    materialized.source = canvas
    const source = this._createSvgImageSource(descriptor)
    const image = new Image()
    materialized.loader = image
    image.onload = (): void => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      materialized.source = canvas
      materialized.version = (materialized.version ?? 0) + 1
      source.revoke?.()
      materialized.ready = true
      materialized.loading = false
      materialized.loader = undefined
      this._onUpdate?.()
    }
    image.onerror = (): void => {
      source.revoke?.()
      materialized.loading = false
      materialized.loader = undefined
      this._onUpdate?.()
    }
    image.src = source.url
    this._materialized.set(record.ref.id, materialized)
    return materialized
  }

  /**
   * Создает browser-loadable SVG image source из raw svg или data URL.
   */
  private _createSvgImageSource(descriptor: NovaSvgAssetDescriptor): { url: string, revoke?: () => void } {
    const svg = this._resolveSvgSource(descriptor)
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    return { url, revoke: () => URL.revokeObjectURL(url) }
  }

  /**
   * Нормализует raw svg/data URL и применяет currentColor override.
   */
  private _resolveSvgSource(descriptor: NovaSvgAssetDescriptor): string {
    const source = descriptor.source.trim()
    const svg = source.startsWith('data:image/svg+xml')
      ? decodeSvgDataUrl(source)
      : descriptor.source
    return descriptor.color
      ? svg.split('currentColor').join(descriptor.color)
      : svg
  }

  /**
   * Создает canvas pattern source с учетом размера и scale.
   */
  private _createPatternCanvas(source: CanvasImageSource, descriptor: NovaPatternAssetDescriptor): HTMLCanvasElement {
    const sourceWidth = resolveAssetSourceWidth(source)
    const sourceHeight = resolveAssetSourceHeight(source)
    const scale = Math.max(0.01, descriptor.scale ?? 1)
    const width = Math.max(1, Math.ceil(descriptor.width ?? sourceWidth * scale))
    const height = Math.max(1, Math.ceil(descriptor.height ?? sourceHeight * scale))
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = width
    canvas.height = height

    if (!ctx) {
      return canvas
    }

    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(
      source,
      descriptor.offsetX ?? 0,
      descriptor.offsetY ?? 0,
      Math.max(1, sourceWidth * scale),
      Math.max(1, sourceHeight * scale),
    )
    return canvas
  }

  /**
   * Создает image-backed materialization для source или url.
   */
  private _createImageBackedMaterialization(
    record: NovaAssetRecord,
    source: CanvasImageSource | string,
    materialize: (source: CanvasImageSource) => CanvasImageSource,
  ): AssetMaterialization {
    if (typeof source !== 'string') {
      return {
        source: materialize(source),
        ready: true,
      }
    }

    const materialized: AssetMaterialization = { ready: false, loading: true }
    const image = new Image()
    materialized.loader = image
    image.onload = (): void => {
      materialized.source = materialize(image)
      materialized.version = (materialized.version ?? 0) + 1
      materialized.ready = true
      materialized.loading = false
      materialized.loader = undefined
      this._onUpdate?.()
    }
    image.onerror = (): void => {
      materialized.loading = false
      materialized.loader = undefined
      this._onUpdate?.()
    }
    image.src = source
    this._materialized.set(record.ref.id, materialized)
    return materialized
  }

  /**
   * Снимает зарегистрированный FontFace из document.fonts.
   */
  private _unuseFontFace(id: string): void {
    const face = this._fontFaces.get(id)
    if (!face) {
      return
    }
    this._fontFaces.delete(id)
    try {
      document.fonts?.delete(face)
    }
    catch {
      // document.fonts может отсутствовать в тестовой или серверной среде.
    }
  }
}

/**
 * Создает Nova asset ref.
 */
function createAssetRef<K extends NovaAssetKind>(namespace: string, kind: K, name: string): NovaAssetRef<K> {
  return Object.freeze({
    __novaAssetRef: true as const,
    namespace,
    kind,
    name,
    id: `${namespace}/${kind}s/${name}`,
  })
}

/**
 * Создает asset bundle.
 */
export function defineNovaAssets<
  I extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>,
  F extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>,
  M extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>,
  T extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>,
>(
  namespace: string,
  input: {
    readonly icons?: I
    readonly fills?: F
    readonly images?: M
    readonly fonts?: T
  },
): NovaAssetBundle<I, F, M, T> {
  const records = new Map<string, NovaAssetRecord>()
  const icons = {} as { [K in keyof I]: NovaAssetRef<'icon'> }
  const fills = {} as { [K in keyof F]: NovaAssetRef<'fill'> }
  const images = {} as { [K in keyof M]: NovaAssetRef<'image'> }
  const fonts = {} as { [K in keyof T]: NovaAssetRef<'font'> }

  for (const [name, descriptor] of Object.entries(input.icons ?? {}) as Array<[keyof I & string, NovaAssetDescriptor]>) {
    const ref = createAssetRef(namespace, 'icon', name)
    icons[name] = ref
    records.set(ref.id, { ref, descriptor })
  }

  for (const [name, descriptor] of Object.entries(input.fills ?? {}) as Array<[keyof F & string, NovaAssetDescriptor]>) {
    const ref = createAssetRef(namespace, 'fill', name)
    fills[name] = ref
    records.set(ref.id, { ref, descriptor })
  }

  for (const [name, descriptor] of Object.entries(input.images ?? {}) as Array<[keyof M & string, NovaAssetDescriptor]>) {
    const ref = createAssetRef(namespace, 'image', name)
    images[name] = ref
    records.set(ref.id, { ref, descriptor })
  }

  for (const [name, descriptor] of Object.entries(input.fonts ?? {}) as Array<[keyof T & string, NovaAssetDescriptor]>) {
    const ref = createAssetRef(namespace, 'font', name)
    fonts[name] = ref
    records.set(ref.id, { ref, descriptor })
  }

  return Object.freeze({
    namespace,
    icons: Object.freeze(icons),
    fills: Object.freeze(fills),
    images: Object.freeze(images),
    fonts: Object.freeze(fonts),
    records,
  })
}

/**
 * Создает SVG descriptor.
 */
export function createNovaSvgAsset(
  source: string,
  options: { width: number, height: number, color?: string, pixelRatio?: NovaSvgAssetPixelRatio },
): NovaSvgAssetDescriptor {
  return Object.freeze({
    type: 'svg',
    source,
    width: options.width,
    height: options.height,
    color: options.color,
    pixelRatio: options.pixelRatio ?? 'auto',
  })
}

/**
 * Вычисляет внутренний pixel ratio для SVG rasterization.
 */
function resolveSvgAssetPixelRatio(pixelRatio: NovaSvgAssetPixelRatio | undefined): number {
  if (pixelRatio === undefined || pixelRatio === 'auto') {
    const raw = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    return Math.max(1, Math.min(raw, 2))
  }
  return Math.max(0.01, pixelRatio)
}

/**
 * Создает image descriptor.
 */
export function createNovaImageAsset(
  source: CanvasImageSource | string,
  options: { width?: number, height?: number } = {},
): NovaImageAssetDescriptor {
  return Object.freeze({
    type: 'image',
    source,
    width: options.width,
    height: options.height,
  })
}

/**
 * Создает canvas descriptor.
 */
export function createNovaCanvasAsset(
  source: HTMLCanvasElement | OffscreenCanvas,
  options: { width?: number, height?: number } = {},
): NovaCanvasAssetDescriptor {
  return Object.freeze({
    type: 'canvas',
    source,
    width: options.width,
    height: options.height,
  })
}

/**
 * Создает pattern descriptor.
 */
export function createNovaPatternAsset(
  source: CanvasImageSource | string,
  options: {
    repeat?: Exclude<NovaAssetFillMode, 'stretch'>
    width?: number
    height?: number
    scale?: number
    offsetX?: number
    offsetY?: number
  } = {},
): NovaPatternAssetDescriptor {
  return Object.freeze({
    type: 'pattern',
    source,
    repeat: options.repeat ?? 'repeat',
    width: options.width,
    height: options.height,
    scale: options.scale,
    offsetX: options.offsetX,
    offsetY: options.offsetY,
  })
}

/**
 * Создает stripe descriptor.
 */
export function createNovaStripeAsset(options: {
  bgColor: string
  stripeColor: string
  stripeWidth: number
  angle?: number
  sizeK?: number
}): NovaStripeAssetDescriptor {
  return Object.freeze({
    type: 'stripe',
    bgColor: options.bgColor,
    stripeColor: options.stripeColor,
    stripeWidth: Math.max(1, options.stripeWidth),
    angle: options.angle ?? 45,
    sizeK: options.sizeK ?? 50,
  })
}

/**
 * Создает linear-gradient descriptor.
 */
export function createNovaLinearGradientAsset(options: {
  from: string
  to: string
  angle?: number
  stops?: ReadonlyArray<NovaLinearGradientStop>
  size?: number
}): NovaLinearGradientAssetDescriptor {
  return Object.freeze({
    type: 'linear-gradient',
    from: options.from,
    to: options.to,
    angle: options.angle ?? 90,
    stops: options.stops,
    size: options.size,
  })
}

/**
 * Создает radial-gradient descriptor.
 */
export function createNovaRadialGradientAsset(options: {
  inner: string
  outer: string
  centerX?: number
  centerY?: number
  radiusX?: number
  radiusY?: number
  stops?: ReadonlyArray<NovaGradientStop>
  size?: number
}): NovaRadialGradientAssetDescriptor {
  return Object.freeze({
    type: 'radial-gradient',
    inner: options.inner,
    outer: options.outer,
    centerX: options.centerX ?? 0.5,
    centerY: options.centerY ?? 0.5,
    radiusX: options.radiusX ?? 0.5,
    radiusY: options.radiusY ?? options.radiusX ?? 0.5,
    stops: options.stops,
    size: options.size,
  })
}

/**
 * Создает conic-gradient descriptor.
 */
export function createNovaConicGradientAsset(options: {
  from: string
  to: string
  centerX?: number
  centerY?: number
  startAngle?: number
  stops?: ReadonlyArray<NovaGradientStop>
  size?: number
}): NovaConicGradientAssetDescriptor {
  return Object.freeze({
    type: 'conic-gradient',
    from: options.from,
    to: options.to,
    centerX: options.centerX ?? 0.5,
    centerY: options.centerY ?? 0.5,
    startAngle: options.startAngle ?? 0,
    stops: options.stops,
    size: options.size,
  })
}

/**
 * Создает noise descriptor.
 */
export function createNovaNoiseAsset(options: {
  baseColor?: string
  noiseColor?: string
  opacity?: number
  density?: number
  seed?: number
  size?: number
} = {}): NovaNoiseAssetDescriptor {
  return Object.freeze({
    type: 'noise',
    baseColor: options.baseColor ?? 'rgba(255,255,255,0)',
    noiseColor: options.noiseColor ?? 'rgba(15,23,42,1)',
    opacity: options.opacity ?? 0.18,
    density: options.density ?? 1,
    seed: options.seed ?? 1,
    size: options.size,
  })
}

/**
 * Создает mesh-gradient descriptor.
 */
export function createNovaMeshGradientAsset(options: {
  background?: string
  points: ReadonlyArray<NovaMeshGradientPoint>
  size?: number
}): NovaMeshGradientAssetDescriptor {
  return Object.freeze({
    type: 'mesh-gradient',
    background: options.background ?? 'transparent',
    points: options.points,
    size: options.size,
  })
}

/**
 * Создает nine-slice image descriptor.
 */
export function createNovaNineSliceImageAsset(
  source: CanvasImageSource | string,
  options: {
    slice: number | Partial<NovaNineSliceInsets>
    width?: number
    height?: number
    centerMode?: 'stretch' | 'repeat'
  },
): NovaNineSliceImageAssetDescriptor {
  return Object.freeze({
    type: 'nine-slice-image',
    source,
    slice: normalizeNineSliceInsets(options.slice),
    width: options.width,
    height: options.height,
    centerMode: options.centerMode ?? 'stretch',
  })
}

/**
 * Создает font descriptor.
 */
export function createNovaFontAsset(options: {
  family: string
  src: string
  weight?: string
  style?: string
  display?: NovaFontAssetDescriptor['display']
}): NovaFontAssetDescriptor {
  return Object.freeze({
    type: 'font',
    family: options.family,
    src: options.src,
    weight: options.weight,
    style: options.style,
    display: options.display,
  })
}

/**
 * Возвращает fill mode по descriptor.
 */
export function resolveNovaAssetFillMode(descriptor: NovaAssetDescriptor): NovaAssetFillMode {
  switch (descriptor.type) {
    case 'stripe':
      return 'repeat'
    case 'pattern':
      return descriptor.repeat
    case 'linear-gradient':
    case 'radial-gradient':
    case 'conic-gradient':
    case 'noise':
    case 'mesh-gradient':
    case 'image':
    case 'nine-slice-image':
      return 'stretch'
    default:
      return 'repeat'
  }
}

/**
 * Описывает публичный Nova assets facade.
 */
export const NovaAssets = Object.freeze({
  global: new NovaAssetRegistry(),
  define: defineNovaAssets,
  svg: createNovaSvgAsset,
  image: createNovaImageAsset,
  canvas: createNovaCanvasAsset,
  pattern: createNovaPatternAsset,
  stripe: createNovaStripeAsset,
  linearGradient: createNovaLinearGradientAsset,
  radialGradient: createNovaRadialGradientAsset,
  conicGradient: createNovaConicGradientAsset,
  noise: createNovaNoiseAsset,
  meshGradient: createNovaMeshGradientAsset,
  nineSliceImage: createNovaNineSliceImageAsset,
  font: createNovaFontAsset,
  /**
   * Выполняет действие ref в рамках ответственности текущего класса.
   */
  ref<K extends NovaAssetKind>(namespace: string, kind: K, name: string): NovaAssetRef<K> {
    return createAssetRef(namespace, kind, name)
  },
})

/**
 * Нормализует nine-slice insets.
 */
function normalizeNineSliceInsets(input: number | Partial<NovaNineSliceInsets>): NovaNineSliceInsets {
  if (typeof input === 'number') {
    return { top: input, right: input, bottom: input, left: input }
  }

  return {
    top: input.top ?? 0,
    right: input.right ?? input.left ?? 0,
    bottom: input.bottom ?? input.top ?? 0,
    left: input.left ?? input.right ?? 0,
  }
}

/**
 * Декодирует data:image/svg+xml URL в SVG source.
 */
function decodeSvgDataUrl(source: string): string {
  const commaIndex = source.indexOf(',')
  if (commaIndex < 0) {
    return source
  }

  const metadata = source.slice(0, commaIndex).toLowerCase()
  const payload = source.slice(commaIndex + 1)
  if (metadata.includes(';base64')) {
    return atob(payload)
  }

  return decodeURIComponent(payload)
}

/**
 * Нормализует gradient stops.
 */
function normalizeGradientStops(stops: ReadonlyArray<NovaGradientStop> | undefined, from: string, to: string): Array<NovaGradientStop> {
  const source = stops?.length
    ? stops
    : [
        { offset: 0, color: from },
        { offset: 1, color: to },
      ]
  return [...source]
    .map(stop => ({ offset: clamp01(stop.offset), color: stop.color }))
    .sort((left, right) => left.offset - right.offset)
}

/**
 * Сэмплирует color из stops.
 */
function sampleGradientStops(stops: ReadonlyArray<NovaGradientStop>, offset: number): RgbaColor {
  const safeOffset = clamp01(offset)
  let left = stops[0]
  let right = stops[stops.length - 1]

  for (let index = 0; index < stops.length - 1; index += 1) {
    const current = stops[index]
    const next = stops[index + 1]
    if (safeOffset >= current.offset && safeOffset <= next.offset) {
      left = current
      right = next
      break
    }
  }

  const span = Math.max(0.00001, right.offset - left.offset)
  const t = clamp01((safeOffset - left.offset) / span)
  const leftColor = parseAssetColor(left.color)
  const rightColor = parseAssetColor(right.color)
  return {
    r: mixChannel(leftColor.r, rightColor.r, t),
    g: mixChannel(leftColor.g, rightColor.g, t),
    b: mixChannel(leftColor.b, rightColor.b, t),
    a: mixChannel(leftColor.a, rightColor.a, t),
  }
}

/**
 * Парсит базовые CSS color формы для procedural fallback.
 */
function parseAssetColor(color: string): RgbaColor {
  const input = color.trim()
  if (input.startsWith('#')) {
    const hex = input.slice(1)
    const full = hex.length === 3
      ? hex.split('').map(part => part + part).join('')
      : hex.padEnd(6, '0').slice(0, 6)
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: 255,
    }
  }

  const rgba = input.match(/rgba?\(([^)]+)\)/)
  if (rgba) {
    const parts = rgba[1].split(',').map(part => part.trim())
    return {
      r: clampByte(Number(parts[0] ?? 0)),
      g: clampByte(Number(parts[1] ?? 0)),
      b: clampByte(Number(parts[2] ?? 0)),
      a: clampByte((parts[3] === undefined ? 1 : Number(parts[3])) * 255),
    }
  }

  return { r: 0, g: 0, b: 0, a: 255 }
}

/**
 * Добавляет alpha в CSS color.
 */
function withAlpha(color: string, alpha: number): string {
  const parsed = parseAssetColor(color)
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${(parsed.a / 255) * clamp01(alpha)})`
}

/**
 * Ограничивает число диапазоном 0..1.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

/**
 * Ограничивает число byte диапазоном.
 */
function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(255, Math.round(value)))
}

/**
 * Смешивает два byte channel.
 */
function mixChannel(from: number, to: number, mix: number): number {
  return clampByte(from + (to - from) * clamp01(mix))
}

/**
 * Возвращает positive modulo.
 */
function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo
}

/**
 * Генерирует deterministic pseudo-random seed.
 */
function seededRandom(seed: number): number {
  return (seed * 1103515245 + 12345) & 0x7FFFFFFF
}

/**
 * Возвращает width drawable source.
 */
function resolveAssetSourceWidth(source: CanvasImageSource): number {
  if ('naturalWidth' in source) {
    return Math.max(1, Number(source.naturalWidth) || 1)
  }
  if ('width' in source) {
    return Math.max(1, Number(source.width) || 1)
  }
  return Math.max(1, Number(source.displayWidth) || 1)
}

/**
 * Возвращает height drawable source.
 */
function resolveAssetSourceHeight(source: CanvasImageSource): number {
  if ('naturalHeight' in source) {
    return Math.max(1, Number(source.naturalHeight) || 1)
  }
  if ('height' in source) {
    return Math.max(1, Number(source.height) || 1)
  }
  return Math.max(1, Number(source.displayHeight) || 1)
}
