/**
 * Описывает kind Nova asset.
 */
export type NovaAssetKind = 'icon' | 'image' | 'fill'

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
}

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
 * Описывает asset descriptor.
 */
export type NovaAssetDescriptor =
  | NovaSvgAssetDescriptor
  | NovaImageAssetDescriptor
  | NovaCanvasAssetDescriptor
  | NovaStripeAssetDescriptor

/**
 * Описывает input bundle assets.
 */
export interface NovaAssetBundleInput {
  readonly icons?: Record<string, NovaAssetDescriptor>
  readonly images?: Record<string, NovaAssetDescriptor>
  readonly fills?: Record<string, NovaAssetDescriptor>
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
export interface NovaAssetBundle<I extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>, F extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>, M extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>> {
  readonly namespace: string
  readonly icons: { readonly [K in keyof I]: NovaAssetRef<'icon'> }
  readonly fills: { readonly [K in keyof F]: NovaAssetRef<'fill'> }
  readonly images: { readonly [K in keyof M]: NovaAssetRef<'image'> }
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
      this._records.set(id, record)
    }
  }

  /**
   * Удаляет bundle из текущего scope.
   */
  unuse(bundle: NovaAssetBundle): void {
    for (const id of bundle.records.keys()) {
      this._records.delete(id)
      this._materialized.delete(id)
    }
  }

  /**
   * Возвращает asset record по ref или id.
   */
  resolveRecord(input: NovaAssetRef | string | undefined | null): NovaAssetRecord | undefined {
    if (!input) return undefined
    const id = isNovaAssetRef(input) ? input.id : input
    return this._records.get(id) ?? this._parent?.resolveRecord(id)
  }

  /**
   * Возвращает resolved asset.
   */
  resolve(input: NovaAssetRef | string | undefined | null): NovaResolvedAsset | undefined {
    const record = this.resolveRecord(input)
    if (!record) return undefined

    const materialized = this.resolveMaterialization(record)
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
    if (!input) return undefined
    if (typeof input === 'string' || isNovaAssetRef(input)) {
      return this.resolve(input)?.source
    }
    return input
  }

  /**
   * Возвращает стабильный drawable key.
   */
  resolveDrawableKey(prefix: string, input: NovaAssetDrawableInput, fallback: (source: CanvasImageSource) => string): string {
    if (typeof input === 'string') return `${prefix}:${input}`
    if (isNovaAssetRef(input)) return `${prefix}:${input.id}`
    if (input) return `${prefix}:${fallback(input)}`
    return `${prefix}:missing`
  }

  /**
   * Возвращает materialized asset.
   */
  private resolveMaterialization(record: NovaAssetRecord): AssetMaterialization {
    const cached = this._materialized.get(record.ref.id)
    if (cached) return cached

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
          source: this.createStripeCanvas(descriptor),
          ready: true,
        }
        break
      case 'image':
        materialized = this.createImageMaterialization(record, descriptor)
        break
      case 'svg':
        materialized = this.createSvgMaterialization(record, descriptor)
        break
      default:
        materialized = { ready: false }
        break
    }

    this._materialized.set(record.ref.id, materialized)
    return materialized
  }

  /**
   * Создает canvas с stripe fill.
   */
  private createStripeCanvas(descriptor: NovaStripeAssetDescriptor): HTMLCanvasElement {
    const stripeWidth = Math.max(1, descriptor.stripeWidth)
    const patternSize = Math.ceil(Math.sqrt(2) * stripeWidth * Math.max(2, descriptor.sizeK))
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = patternSize
    canvas.height = patternSize

    if (!ctx) return canvas

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
   * Создает materialization для image asset.
   */
  private createImageMaterialization(record: NovaAssetRecord, descriptor: NovaImageAssetDescriptor): AssetMaterialization {
    if (typeof descriptor.source !== 'string') {
      return {
        source: descriptor.source,
        ready: true,
      }
    }

    const materialized: AssetMaterialization = { ready: false, loading: true }
    const image = new Image()
    image.onload = (): void => {
      materialized.source = image
      materialized.ready = true
      materialized.loading = false
      this._onUpdate?.()
    }
    image.onerror = (): void => {
      materialized.loading = false
      this._onUpdate?.()
    }
    image.src = descriptor.source
    this._materialized.set(record.ref.id, materialized)
    return materialized
  }

  /**
   * Создает materialization для SVG asset.
   */
  private createSvgMaterialization(record: NovaAssetRecord, descriptor: NovaSvgAssetDescriptor): AssetMaterialization {
    const materialized: AssetMaterialization = { ready: false, loading: true }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = Math.max(1, descriptor.width)
    canvas.height = Math.max(1, descriptor.height)
    materialized.source = canvas

    if (!ctx) {
      materialized.ready = true
      materialized.loading = false
      return materialized
    }

    const svg = descriptor.color
      ? descriptor.source.split('currentColor').join(descriptor.color)
      : descriptor.source
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = (): void => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      materialized.ready = true
      materialized.loading = false
      this._onUpdate?.()
    }
    image.onerror = (): void => {
      URL.revokeObjectURL(url)
      materialized.loading = false
      this._onUpdate?.()
    }
    image.src = url
    this._materialized.set(record.ref.id, materialized)
    return materialized
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
export function defineNovaAssets<I extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>, F extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>, M extends Record<string, NovaAssetDescriptor> = Record<string, NovaAssetDescriptor>>(
  namespace: string,
  input: {
    readonly icons?: I
    readonly fills?: F
    readonly images?: M
  },
): NovaAssetBundle<I, F, M> {
  const records = new Map<string, NovaAssetRecord>()
  const icons = {} as { [K in keyof I]: NovaAssetRef<'icon'> }
  const fills = {} as { [K in keyof F]: NovaAssetRef<'fill'> }
  const images = {} as { [K in keyof M]: NovaAssetRef<'image'> }

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

  return Object.freeze({
    namespace,
    icons: Object.freeze(icons),
    fills: Object.freeze(fills),
    images: Object.freeze(images),
    records,
  })
}

/**
 * Создает SVG descriptor.
 */
export function createNovaSvgAsset(
  source: string,
  options: { width: number; height: number; color?: string },
): NovaSvgAssetDescriptor {
  return Object.freeze({
    type: 'svg',
    source,
    width: options.width,
    height: options.height,
    color: options.color,
  })
}

/**
 * Создает image descriptor.
 */
export function createNovaImageAsset(
  source: CanvasImageSource | string,
  options: { width?: number; height?: number } = {},
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
  options: { width?: number; height?: number } = {},
): NovaCanvasAssetDescriptor {
  return Object.freeze({
    type: 'canvas',
    source,
    width: options.width,
    height: options.height,
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
 * Описывает публичный Nova assets facade.
 */
export const NovaAssets = Object.freeze({
  global: new NovaAssetRegistry(),
  define: defineNovaAssets,
  svg: createNovaSvgAsset,
  image: createNovaImageAsset,
  canvas: createNovaCanvasAsset,
  stripe: createNovaStripeAsset,
  ref<K extends NovaAssetKind>(namespace: string, kind: K, name: string): NovaAssetRef<K> {
    return createAssetRef(namespace, kind, name)
  },
})
