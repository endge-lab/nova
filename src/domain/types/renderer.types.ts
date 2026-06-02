import type { mat3 } from 'gl-matrix'
import type { DataRect } from '@endge/utils'
import type { NovaAssetDrawableInput, NovaAssetRef, NovaNineSliceInsets } from '@/model/runtime/assets/NovaAssetRegistry'
import type { NovaSemanticSchemaItem } from '@/domain/types/semantic.types'

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
export type NovaStyleBackground = string | ImageBitmap | HTMLCanvasElement | OffscreenCanvas | NovaAssetRef<'fill' | 'image'>

/**
 * Описывает контракт NovaUIBase.
 */
export interface NovaUIBase {
  active?: boolean
  clip?: DataRect | true
  meta?: NovaSchemaItemMeta
  semantic?: false | NovaSemanticSchemaItem
}

/**
 * Описывает режим рендеринга текста.
 */
export type NovaTextRenderMode = 'auto' | 'run-atlas' | 'glyph-atlas' | 'msdf'

/**
 * Описывает роль текста внутри продуктового canvas.
 */
export type NovaTextRenderRole = 'timescale' | 'task-label' | 'ui-label' | 'debug'

/**
 * Описывает LOD-поведение конкретного text item.
 */
export type NovaTextLodMode = 'auto' | 'always' | 'hide-while-moving'

/**
 * Описывает общие metadata schema item.
 */
export interface NovaSchemaItemMeta {
  textMode?: NovaTextRenderMode
  textRole?: NovaTextRenderRole
  textPriority?: number
  textLod?: NovaTextLodMode
  [key: string]: any
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
    radius?: number
    border?: {
      color?: string
      width?: number
      radius?: number
      dashPattern?: [number, number]
      position?: Array<'left' | 'right' | 'top' | 'bottom'> | 'vertical' | 'horizontal' | 'all'
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
  position?: Array<'left' | 'right' | 'top' | 'bottom'> | 'vertical' | 'horizontal' | 'all'
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
  rotation?: number
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
      /**
       * Управляет горизонтальным выравниванием, когда текст шире content-box.
       * start повторяет поведение старого renderer: overflow-текст начинается от
       * левого края, чтобы в clip была видна первая часть строки.
       */
      overflow?: 'start' | 'preserve'
    }
    ellipsis?: boolean
    opacity?: number
  }
}

/**
 * Описывает тип font стилей текста.
 */
export type NovaTextFont = NonNullable<NovaText['styles']>['font']

/**
 * Описывает тип align стилей текста.
 */
export type NovaTextAlign = NonNullable<NovaText['styles']>['align']

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
    dashPattern?: Array<number>
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
 * Описывает контракт NovaArc.
 */
export interface NovaArc extends NovaUIBase {
  x: number
  y: number
  radius: number
  startAngle: number
  endAngle: number
  counterClockwise?: boolean
  styles?: {
    color?: string
    width?: number
    lineCap?: 'butt' | 'round' | 'square'
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
 * Описывает preset качества рендеринга иконок.
 */
export type NovaIconRenderQualityPreset = 'auto' | 'crisp' | 'readable-dense'

/**
 * Описывает настройки readable рендеринга иконок для плотных Canvas UI.
 */
export interface NovaIconRenderQualityOptions {
  mode?: NovaIconRenderQualityPreset
  snapToPixel?: boolean
  minDpr1Size?: number
  dpr1ScaleBoost?: number
  maxScaleBoost?: number
  dpr1OpacityBoost?: number
  maxOpacity?: number
}

/**
 * Описывает контракт NovaIcon.
 */
export interface NovaIcon extends NovaUIBase {
  x: number
  y: number
  width: number
  height: number

  // Либо Nova asset ref, либо готовый canvas/image источник.
  icon: CanvasImageSource | NovaAssetRef<'icon' | 'image'> | string

  styles?: {
    opacity?: number
    quality?: NovaIconRenderQualityPreset | NovaIconRenderQualityOptions
  }
}

/**
 * Описывает контракт NovaNineSliceImage.
 */
export interface NovaNineSliceImage extends NovaUIBase {
  x: number
  y: number
  width: number
  height: number
  image: NovaAssetRef<'image'> | string
  slice?: number | Partial<NovaNineSliceInsets>
  centerMode?: 'stretch' | 'repeat'
  styles?: {
    opacity?: number
  }
}

/**
 * Описывает процедурный dot-grid pattern для фоновых canvas-слоев.
 */
export interface NovaDotGridPattern {
  type: 'dot-grid'
  color: string
  originX: number
  originY: number
  worldStep: number
  scale: number
  minScreenStep?: number
  size?: number
  shape?: 'square' | 'circle'
  opacity?: number
}

/**
 * Описывает прямоугольник с процедурным pattern-фоном.
 */
export interface NovaPatternRect extends NovaUIBase {
  x: number
  y: number
  width: number
  height: number
  pattern: NovaDotGridPattern
  styles?: {
    opacity?: number
  }
}

/**
 * Описывает контракт NovaPolygon.
 */
export interface NovaPolygon extends NovaUIBase {
  points: Array<{ x: number; y: number }>
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
export type NovaParticleNumberData = Float32Array | ReadonlyArray<number>

/**
 * Описывает массив числовых данных rect stream.
 */
export type NovaRectNumberData = Float32Array | ReadonlyArray<number>

/**
 * Описывает retained rect batch для плотных прямоугольных сцен.
 */
export interface NovaRectBatch extends NovaUIBase {
  count: number
  x: NovaRectNumberData
  y: NovaRectNumberData
  width: NovaRectNumberData
  height: NovaRectNumberData
  colors: NovaRectNumberData
  states?: NovaRectNumberData
  opacity?: number
  revision?: number
  staticRevision?: number
}

/**
 * Описывает retained batch временных сегментов, где x/width вычисляются на GPU.
 */
export interface NovaTimeRangeSegmentBatch extends NovaUIBase {
  count: number
  startTime: NovaRectNumberData
  endTime: NovaRectNumberData
  y: NovaRectNumberData
  height: NovaRectNumberData
  colors: NovaRectNumberData
  styles?: NovaRectNumberData
  timeOrigin: number
  timeStart: number
  pxPerMs: number
  viewportX: number
  yOffset: number
  revision?: number
  staticRevision?: number
}

/**
 * Описывает retained stripe batch.
 */
export interface NovaStripeRectBatch extends NovaUIBase {
  count: number
  x: NovaRectNumberData
  y: NovaRectNumberData
  width: NovaRectNumberData
  height: NovaRectNumberData
  fills: ReadonlyArray<NovaAssetDrawableInput>
  opacity?: number
  revision?: number
  staticRevision?: number
}

/**
 * Описывает retained icon batch.
 */
export interface NovaIconBatch extends NovaUIBase {
  count: number
  x: NovaRectNumberData
  y: NovaRectNumberData
  width: NovaRectNumberData
  height: NovaRectNumberData
  icons: ReadonlyArray<NovaAssetDrawableInput>
  opacity?: number
  revision?: number
  staticRevision?: number
}

/**
 * Описывает retained text batch.
 */
export interface NovaTextBatch extends NovaUIBase {
  count: number
  text: ReadonlyArray<string>
  x: NovaRectNumberData
  y: NovaRectNumberData
  width: NovaRectNumberData
  height: NovaRectNumberData
  clipX?: NovaRectNumberData
  clipY?: NovaRectNumberData
  clipWidth?: NovaRectNumberData
  clipHeight?: NovaRectNumberData
  color?: string | ReadonlyArray<string>
  font?: NovaTextFont | ReadonlyArray<NovaTextFont | undefined>
  align?: NovaTextAlign | ReadonlyArray<NovaTextAlign | undefined>
  lineHeight?: number
  padding?: NovaStylePadding
  ellipsis?: boolean
  opacity?: number
  priority?: number | ReadonlyArray<number> | Float32Array
  dirtyIndices?: ReadonlyArray<number> | Uint32Array
  revision?: number
  staticRevision?: number
}

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
  | ({ type: 'arc' } & NovaArc)
  | ({ type: 'icon' } & NovaIcon)
  | ({ type: 'nine-slice-image' } & NovaNineSliceImage)
  | ({ type: 'pattern-rect' } & NovaPatternRect)
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
  dirtyIndices?: ReadonlyArray<number>
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
  arc: boolean
  polygon: boolean
  icon: boolean
  text: boolean
  patternRects: boolean
  particles: boolean
  rectBatches: boolean
  stripeBatches: boolean
  iconBatches: boolean
  textBatches: boolean
  measureText: boolean
}

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
 * Описывает статистику compile-фазы retained frame.
 */
export interface NovaRenderCompileStats {
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
 * Описывает сохраненную границу mutable render-state.
 */
export interface NovaRendererStateMark {
  transformDepth: number
  clipDepth: number
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
  markState(): NovaRendererStateMark
  restoreState(mark: NovaRendererStateMark): void

  setTransform(matrix: mat3): void

  beginRenderTarget?(id: string, width: number, height: number, options?: { dpr?: number; kind?: 'texture' | 'cache' | 'effect' }): void
  endRenderTarget?(): void
  drawRenderTarget?(id: string, x: number, y: number, width: number, height: number): void

  text(params: NovaText): void
  rect(params: NovaRect): void
  border(params: NovaBorder): void
  line(params: NovaLine): void
  circle(params: NovaCircle): void
  arc(params: NovaArc): void
  polygon(params: NovaPolygon): void
  icon(params: NovaIcon): void
  patternRect(params: NovaPatternRect): void
  rects(batch: NovaRectBatch): void
  timeRangeSegments(batch: NovaTimeRangeSegmentBatch): void
  stripes(batch: NovaStripeRectBatch): void
  icons(batch: NovaIconBatch): void
  texts(batch: NovaTextBatch): void
  particles(batch: NovaParticleBatch): void

  measureText(params: NovaText): { width: number; height: number }

  cursor(type: string): void

  destroy(): void
}

/**
 * Описывает контракт Batch.
 */
export interface Batch<G = unknown, T = unknown> {
  id: number
  tasks: Array<any>
  taskIds: Set<string>
  readonly __types?: {
    group: G
    task: T
  }
}
