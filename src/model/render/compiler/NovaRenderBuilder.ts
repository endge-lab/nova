import type { mat3 } from 'gl-matrix'
import type {
  NovaArc,
  NovaBorder,
  NovaCircle,
  NovaIcon,
  NovaIconBatch,
  NovaLine,
  NovaParticleBatch,
  NovaPolygon,
  NovaRect,
  NovaRectBatch,
  NovaRenderer,
  NovaRendererCapabilities,
  NovaSchema,
  NovaSchemaItem,
  NovaStripeRectBatch,
  NovaText,
  NovaTextBatch,
  NovaTimeRangeSegmentBatch,
} from '@/domain/types/renderer.types'
import type { NovaCanvas } from '@/model/platform/NovaCanvas'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaRenderCommandWriter } from '@/model/render/compiler/NovaRenderCommandWriter'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'

const FAST_SCHEMA_BATCH_THRESHOLD = 64

/**
 * Собирает render commands из вызовов Nova render context.
 */
export class NovaRenderBuilder implements NovaRenderer {
  readonly id = 'render-builder'
  readonly capabilities: NovaRendererCapabilities = {
    canvas2d: false,
    webgl: false,
    schema: true,
    rect: true,
    border: true,
    line: true,
    circle: true,
    arc: true,
    polygon: true,
    icon: true,
    text: true,
    particles: true,
    rectBatches: true,
    stripeBatches: true,
    iconBatches: true,
    textBatches: true,
    measureText: true,
  }

  private readonly _measureCanvas = document.createElement('canvas')
  private readonly _nodeStack: Array<string> = []

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    readonly novaCanvas: NovaCanvas,
    private readonly _schemaRegistry: NovaSchemaRegistry,
    private readonly _writer: NovaRenderCommandWriter,
  ) {}

  /**
   * Выполняет внутреннюю операцию schema.
   */
  schema(schema: NovaSchema<any>): void {
    const items = Array.isArray(schema) ? schema : [schema]

    if (this.schemaBatch(schema, 'ordered')) return

    for (const item of items) {
      this.schemaItem(item as NovaSchemaItem<any>)
    }
  }

  /**
   * Выполняет внутреннюю операцию schema batched.
   */
  schemaBatched(schema: NovaSchema<any>): void {
    if (this.schemaBatch(schema, 'batched')) return
    this.schema(schema)
  }

  /**
   * Выполняет внутреннюю операцию schema ordered.
   */
  schemaOrdered(schema: NovaSchema<any>): void {
    if (this.schemaBatch(schema, 'ordered')) return
    this.schema(schema)
  }

  /**
   * Выполняет внутреннюю операцию save.
   */
  save(): void {
    this._writer.save()
  }

  /**
   * Выполняет внутреннюю операцию restore.
   */
  restore(): void {
    this._writer.restore()
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this._writer.clear()
  }

  /**
   * Выполняет внутреннюю операцию clip.
   */
  clip(x: number, y: number, width: number, height: number): void {
    this._writer.clip(x, y, width, height)
  }

  /**
   * Очищает clip.
   */
  clearClip(): void {
    this._writer.clearClip()
  }

  /**
   * Обновляет transform.
   */
  setTransform(matrix: mat3): void {
    this._writer.setTransform(matrix)
  }

  /**
   * Начинает запись в offscreen render target.
   */
  beginRenderTarget(id: string, width: number, height: number, options?: { dpr?: number; kind?: 'texture' | 'cache' | 'effect' }): void {
    this._writer.beginRenderTarget(id, width, height, options)
  }

  /**
   * Завершает запись в offscreen render target.
   */
  endRenderTarget(): void {
    this._writer.endRenderTarget()
  }

  /**
   * Рисует offscreen render target в текущий target.
   */
  drawRenderTarget(id: string, x: number, y: number, width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    this._writer.drawRenderTarget(id, x, y, width, height)
  }

  /**
   * Выполняет внутреннюю операцию text.
   */
  text(params: NovaText): void {
    this.schemaItem({ ...params, type: 'text' })
  }

  /**
   * Выполняет внутреннюю операцию rect.
   */
  rect(params: NovaRect): void {
    this.schemaItem({ ...params, type: 'rect' })
  }

  /**
   * Выполняет внутреннюю операцию border.
   */
  border(params: NovaBorder): void {
    this.schemaItem({ ...params, type: 'border' })
  }

  /**
   * Выполняет внутреннюю операцию line.
   */
  line(params: NovaLine): void {
    this.schemaItem({ ...params, type: 'line' })
  }

  /**
   * Выполняет внутреннюю операцию circle.
   */
  circle(params: NovaCircle): void {
    this.schemaItem({ ...params, type: 'circle' })
  }

  /**
   * Выполняет внутреннюю операцию arc.
   */
  arc(params: NovaArc): void {
    this.schemaItem({ ...params, type: 'arc' })
  }

  /**
   * Выполняет внутреннюю операцию polygon.
   */
  polygon(params: NovaPolygon): void {
    this.schemaItem({ ...params, type: 'polygon' })
  }

  /**
   * Выполняет внутреннюю операцию icon.
   */
  icon(params: NovaIcon): void {
    this.schemaItem({ ...params, type: 'icon' })
  }

  /**
   * Записывает retained rect batch без разворачивания в schema items.
   */
  rects(batch: NovaRectBatch): void {
    if (batch.active === false || batch.count <= 0) return
    this._writer.drawRectBatch(batch)
  }

  /**
   * Записывает retained time-range segment batch без разворачивания в rect primitives.
   */
  timeRangeSegments(batch: NovaTimeRangeSegmentBatch): void {
    if (batch.active === false || batch.count <= 0) return
    this._writer.drawTimeRangeSegmentBatch(batch)
  }

  /**
   * Записывает retained stripe batch без разворачивания в schema items.
   */
  stripes(batch: NovaStripeRectBatch): void {
    if (batch.active === false || batch.count <= 0) return
    this._writer.drawStripeBatch(batch)
  }

  /**
   * Записывает retained icon batch без разворачивания в schema items.
   */
  icons(batch: NovaIconBatch): void {
    if (batch.active === false || batch.count <= 0) return
    this._writer.drawIconBatch(batch)
  }

  /**
   * Записывает retained text batch без разворачивания в schema items.
   */
  texts(batch: NovaTextBatch): void {
    if (batch.active === false || batch.count <= 0) return
    this._writer.drawTextBatch(batch)
  }

  /**
   * Записывает retained particle batch без разворачивания в schema items.
   */
  particles(batch: NovaParticleBatch): void {
    if (batch.active === false || batch.count <= 0) return
    this._writer.drawParticles(batch)
  }

  /**
   * Выполняет внутреннюю операцию measure text.
   */
  measureText(params: NovaText): { width: number; height: number } {
    const context = this.getMeasureContext()
    const font = params.styles?.font
    const size = font?.size ?? 12
    const family = font?.family ?? 'sans-serif'
    const style = font?.style ?? 'normal'
    const weight = font?.weight ?? 'normal'

    if (context) context.font = `${style} ${weight} ${size}px ${family}`
    const width = context?.measureText(params.text).width ?? params.text.length * size * 0.6
    return {
      width,
      height: params.styles?.lineHeight ?? size,
    }
  }

  /**
   * Возвращает measure context.
   */
  private getMeasureContext(): CanvasRenderingContext2D | null {
    if (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')) {
      return null
    }

    try {
      return this._measureCanvas.getContext('2d')
    } catch {
      return null
    }
  }

  /**
   * Выполняет внутреннюю операцию cursor.
   */
  cursor(type: string): void {
    this._writer.cursor(type)
  }

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    /* builder does not own GPU resources */
  }

  /**
   * Выполняет внутреннюю операцию begin node.
   */
  beginNode(node: NovaNode<any>): void {
    this._nodeStack.push(this._writer.currentNodeId)
    this._writer.setCurrentNode(node.renderNodeId)
  }

  /**
   * Выполняет внутреннюю операцию end node.
   */
  endNode(): void {
    this._writer.setCurrentNode(this._nodeStack.pop() ?? 'surface')
  }

  /**
   * Выполняет внутреннюю операцию schema item.
   */
  private schemaItem(item: NovaSchemaItem<any>): void {
    if (item.active === false) return

    if (item.clip !== undefined && item.clip !== true) {
      this.clip(item.clip.x, item.clip.y, item.clip.width, item.clip.height)
    }

    switch (item.type) {
      case 'text':
      case 'rect':
      case 'border':
      case 'line':
      case 'circle':
      case 'arc':
      case 'polygon':
      case 'icon':
        this._writer.drawSchemaItem(item)
        break
      default:
        this._schemaRegistry.renderSchemaComponent(this, item, 'schema')
        break
    }

    if (item.clip !== undefined && item.clip !== true) {
      this.clearClip()
    }
  }

  /**
   * Выполняет внутреннюю операцию schema batch.
   */
  private schemaBatch(schema: NovaSchema<any>, mode: 'batched' | 'ordered'): boolean {
    const items = Array.isArray(schema) ? schema : [schema]
    const activeItems = items.some(item => item.active === false)
      ? items.filter(item => item.active !== false)
      : items

    if (activeItems.length < FAST_SCHEMA_BATCH_THRESHOLD) return false

    this._writer.drawSchemaBatch(
      activeItems as Array<NovaSchemaItem<any>>,
      mode,
      Array.isArray(schema) ? schema.semanticScope : undefined,
      Array.isArray(schema) ? schema.contentVersion : undefined,
    )
    return true
  }
}
