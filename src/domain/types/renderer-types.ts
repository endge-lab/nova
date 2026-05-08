import type { NovaCanvas } from '@/domain/entities/graphics/NovaCanvas'
import type { mat3 } from 'gl-matrix'
import type { DataRect } from '@endge/utils'

export enum RendererType {
  Web2D = '2d',
  WebGL = 'webgl',
  WebGLExperimental = 'experimental-webgl',
}

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

export interface NovaUIBase {
  active?: boolean
  clip?: DataRect | true
  meta?: any
}

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

export interface NovaTextChunk {
  text: string
  bold?: boolean
  italic?: boolean
  newline?: boolean
}

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
export type NovaSchemaItem<TCustom extends { type: string } = never> =
  | ({ type: 'rect' } & NovaRect)
  | ({ type: 'border' } & NovaBorder)
  | ({ type: 'text' } & NovaText)
  | ({ type: 'line' } & NovaLine)
  | ({ type: 'circle' } & NovaCircle)
  | ({ type: 'icon' } & NovaIcon)
  | ({ type: 'polygon' } & NovaPolygon)
  | TCustom

export interface NovaCustomSchemaItem extends NovaUIBase {
  type: string
  id?: string
  props?: Record<string, any>
  [key: string]: any
}

export type NovaSchema<TCustom extends { type: string } = never> = Array<NovaSchemaItem<TCustom>>

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
  measureText: boolean
}

export type NovaRenderPipeline = 'immediate' | 'queue'
export type NovaRenderDirtyMode = 'full' | 'subtree'
export type NovaRenderCullingMode = 'off' | 'bounds'
export type NovaHitTestMode = 'linear' | 'spatial'
export type NovaLifecycleState = 'created' | 'mounted' | 'paused' | 'destroyed'

export interface NovaRenderQueueStats {
  commands: number
  items: number
  batches: number
}

export interface NovaRenderSubtreeStats {
  rebuiltNodes: number
  cachedNodes: number
}

export interface NovaRenderCullingStats {
  testedNodes: number
  culledNodes: number
}

export interface NovaBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Рендерер.
 */
export interface NovaRenderer {
  readonly id: string
  readonly novaCanvas: NovaCanvas
  readonly capabilities: NovaRendererCapabilities

  schema(schema: NovaSchema<any>): void
  schemaBatched(schema: NovaSchema<any>): void
  schemaOrdered(schema: NovaSchema<any>): void

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

  measureText(params: NovaText): { width: number; height: number }

  cursor(type: 'default' | 'pointer' | 'col-resize' | 'row-resize'): void

  destroy(): void
}

export interface Batch<G = unknown, T = unknown> {
  id: number
  tasks: any[]
  taskIds: Set<string>
  readonly __types?: {
    group: G
    task: T
  }
}
