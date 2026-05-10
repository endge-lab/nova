import type { mat3 } from 'gl-matrix'
import type { DataRect } from '@endge/utils'

/**
 * Описывает набор значений RendererType.
 */
export enum RendererType {
  Web2D = '2d',
  WebGL = 'webgl',
}

/**
 * Описывает тип NovaStylePadding.
 */
export type NovaStylePadding =
  | {
      left?: number
      right?: number
      top?: number
      bottom?: number
    }
  | {
      horizontal?: number
      vertical?: number
    }
  | {
      all?: number
    }

/**
 * HEX/RGBA/ImageBitmap
 */
export type NovaStyleBackground = string | ImageBitmap | HTMLCanvasElement

/**
 * Описывает контракт NovaUIBase.
 */
export interface NovaUIBase {
  active?: boolean
  clip?: DataRect | true
  meta?: any
}

/**
 * Описывает контракт NovaRect.
 */
export interface NovaRect extends NovaUIBase {
  x: number
  y: number
  width: number
  height: number
  styles?: {
    background?: NovaStyleBackground
    border?: {
      color?: string
      width?: number
      radius?: number
      dashPattern?: [number, number]
      position?: ('left' | 'right' | 'top' | 'bottom')[] | 'vertical' | 'horizontal' | 'all'
    }
    opacity?: number
  }
}

/**
 * Описывает контракт NovaBorder.
 */
export interface NovaBorder extends NovaUIBase {
  x: number
  y: number
  width: number
  height: number
  position?: ('left' | 'right' | 'top' | 'bottom')[] | 'vertical' | 'horizontal' | 'all'
  styles?: {
    color?: string
    width?: number
    radius?: number
    dashPattern?: [number, number]
  }
}

/**
 * Описывает контракт NovaText.
 */
export interface NovaText extends NovaUIBase {
  text: string
  x: number
  y: number
  width: number
  height: number
  parser?: 'string' | 'markdown'
  styles?: {
    color?: string
    font?: {
      family?: string
      size?: number
      style?: 'normal' | 'italic'
      weight?:
        | 'normal'
        | 'bold'
        | 'bolder'
        | 'lighter'
        | '100'
        | '200'
        | '300'
        | '400'
        | '500'
        | '600'
        | '700'
        | '800'
        | '900'
    }
    lineHeight?: number
    padding?: NovaStylePadding
    align?: {
      horizontal?: 'left' | 'center' | 'right'
      vertical?: 'top' | 'middle' | 'bottom'
    }
    ellipsis?: boolean
    opacity?: number
  }
}

/**
 * Описывает контракт NovaLine.
 */
export interface NovaLine extends NovaUIBase {
  x1: number
  y1: number
  x2: number
  y2: number
  styles?: {
    color?: string
    width?: number
    dashPattern?: number[]
    opacity?: number
  }
}

/**
 * Описывает контракт NovaCircle.
 */
export interface NovaCircle extends NovaUIBase {
  x: number
  y: number
  radius: number
  styles?: {
    background?: NovaStyleBackground
    border?: {
      color?: string
      width?: number
      dashPattern?: [number, number]
    }
    opacity?: number
  }
}

/**
 * Описывает контракт NovaTextChunk.
 */
export interface NovaTextChunk {
  text: string
  bold?: boolean
  italic?: boolean
  newline?: boolean
}

/**
 * Описывает контракт NovaIcon.
 */
export interface NovaIcon extends NovaUIBase {
  x: number
  y: number
  width: number
  height: number

  // Либо название загруженной иконки, либо готовый canvas/image источник.
  icon: CanvasImageSource | string

  styles?: {
    opacity?: number
  }
}

/**
 * Описывает контракт NovaPolygon.
 */
export interface NovaPolygon extends NovaUIBase {
  points: { x: number; y: number }[]
  styles?: {
    background?: string
    stroke?: string
    lineWidth?: number
    opacity?: number
  }
}

/**
 * Описывает тип NovaParticleBatchKind.
 */
export type NovaParticleBatchKind = 'circle' | 'sprite'

/**
 * Описывает массив числовых данных particle stream.
 */
export type NovaParticleNumberData = Float32Array | readonly number[]

/**
 * Описывает retained particle batch для массовых dynamic-сцен.
 */
export interface NovaParticleBatch extends NovaUIBase {
  kind: NovaParticleBatchKind
  count: number
  positions: NovaParticleNumberData
  sizes: NovaParticleNumberData
  colors: NovaParticleNumberData
  strokeColors?: NovaParticleNumberData
  strokeWidths?: NovaParticleNumberData
  velocities?: NovaParticleNumberData
  texture?: CanvasImageSource | string
  opacity?: number
  revision?: number
  staticRevision?: number
}

/**
 * Паттерн полосок (например, для заливки фона).
 */
export interface NovaStripePattern {
  stripeColor: string
  backgroundColor: string
  stripeWidth: number
  angle?: number
  sizeK?: number
}

// Универсальная схема
/**
 * Описывает тип NovaSchemaItem.
 */
export type NovaSchemaItem<TCustom extends { type: string } = never> =
  | ({ type: 'rect' } & NovaRect)
  | ({ type: 'border' } & NovaBorder)
  | ({ type: 'text' } & NovaText)
  | ({ type: 'line' } & NovaLine)
  | ({ type: 'circle' } & NovaCircle)
  | ({ type: 'icon' } & NovaIcon)
  | ({ type: 'polygon' } & NovaPolygon)
  | TCustom

/**
 * Описывает контракт NovaCustomSchemaItem.
 */
export interface NovaCustomSchemaItem extends NovaUIBase {
  type: string
  id?: string
  props?: Record<string, any>
  [key: string]: any
}

/**
 * Описывает тип NovaSemanticScopeKind.
 */
export type NovaSemanticScopeKind = 'strict' | 'grid' | 'table' | 'timeline-row' | 'non-overlap-layered'

/**
 * Описывает тип NovaSchema.
 */
export type NovaSchema<TCustom extends { type: string } = never> = Array<NovaSchemaItem<TCustom>> & {
  semanticScope?: NovaSemanticScopeKind
  contentVersion?: number
}

/**
 * Описывает контракт NovaRendererCapabilities.
 */
export interface NovaRendererCapabilities {
  canvas2d: boolean
  webgl: boolean
  schema: boolean
  rect: boolean
  border: boolean
  line: boolean
  circle: boolean
  polygon: boolean
  icon: boolean
  text: boolean
  particles: boolean
  measureText: boolean
}

/**
 * Описывает тип NovaRenderPipeline.
 */
export type NovaRenderPipeline = 'retained'
/**
 * Описывает тип NovaRenderDirtyMode.
 */
export type NovaRenderDirtyMode = 'graph'
/**
 * Описывает тип NovaRenderCullingMode.
 */
export type NovaRenderCullingMode = 'off' | 'bounds'
/**
 * Описывает тип NovaHitTestMode.
 */
export type NovaHitTestMode = 'linear' | 'spatial'
/**
 * Описывает тип NovaLifecycleState.
 */
export type NovaLifecycleState = 'created' | 'mounted' | 'paused' | 'destroyed'

/**
 * Описывает контракт NovaRenderQueueStats.
 */
export interface NovaRenderQueueStats {
  commands: number
  items: number
  batches: number
}

/**
 * Описывает контракт NovaRenderSubtreeStats.
 */
export interface NovaRenderSubtreeStats {
  rebuiltNodes: number
  cachedNodes: number
}

/**
 * Описывает контракт NovaRenderCullingStats.
 */
export interface NovaRenderCullingStats {
  testedNodes: number
  culledNodes: number
}

/**
 * Описывает контракт NovaBounds.
 */
export interface NovaBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Описывает контракт NovaRendererCanvas.
 */
export interface NovaRendererCanvas {
  readonly element: HTMLCanvasElement
  readonly width: number
  readonly height: number
  readonly pixelWidth: number
  readonly pixelHeight: number
  readonly dpr: number
  readonly maxDpr: number

  getBoundingClientRect(): DOMRectReadOnly
  invalidate(): void
  resize(width: number, height: number, options?: { dpr?: number; maxDpr?: number }): void
  getContext2D(): CanvasRenderingContext2D
  destroy(): void
  onContextLost(callback: () => void): void
  onContextRestored(callback: () => void): void
  isContextLost(): boolean
}

/**
 * Рендерер.
 */
export interface NovaRenderer {
  readonly id: string
  readonly novaCanvas: NovaRendererCanvas
  readonly capabilities: NovaRendererCapabilities

  schema(schema: NovaSchema<any>): void

  save(): void
  restore(): void
  clear(): void

  clip(x: number, y: number, width: number, height: number): void
  clearClip(): void

  setTransform(matrix: mat3): void

  text(params: NovaText): void
  rect(params: NovaRect): void
  border(params: NovaBorder): void
  line(params: NovaLine): void
  circle(params: NovaCircle): void
  polygon(params: NovaPolygon): void
  icon(params: NovaIcon): void
  particles(batch: NovaParticleBatch): void

  measureText(params: NovaText): { width: number; height: number }

  cursor(type: 'default' | 'pointer' | 'col-resize' | 'row-resize'): void

  destroy(): void
}

/**
 * Описывает контракт Batch.
 */
export interface Batch<G = unknown, T = unknown> {
  id: number
  tasks: any[]
  taskIds: Set<string>
  readonly __types?: {
    group: G
    task: T
  }
}
