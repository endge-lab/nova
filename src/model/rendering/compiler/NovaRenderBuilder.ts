import type { mat3 } from 'gl-matrix'
import type {
  NovaBorder,
  NovaCircle,
  NovaIcon,
  NovaLine,
  NovaPolygon,
  NovaRect,
  NovaRenderer,
  NovaRendererCapabilities,
  NovaSchema,
  NovaSchemaItem,
  NovaText,
} from '@/domain/types/renderer-types'
import type { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'
import type { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'
import type { NovaRenderCommandWriter } from '@/model/rendering/compiler/NovaRenderCommandWriter'

const FAST_SCHEMA_BATCH_THRESHOLD = 64

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
    polygon: true,
    icon: true,
    text: true,
    measureText: true,
  }

  private readonly _measureCanvas = document.createElement('canvas')

  constructor(
    readonly novaCanvas: NovaCanvas,
    private readonly _schemaRegistry: NovaSchemaRegistry,
    private readonly _writer: NovaRenderCommandWriter,
  ) {}

  schema(schema: NovaSchema<any>): void {
    const items = Array.isArray(schema) ? schema : [schema]

    for (const item of items) {
      this.schemaItem(item as NovaSchemaItem<any>)
    }
  }

  schemaBatched(schema: NovaSchema<any>): void {
    if (this.schemaBatch(schema, 'batched')) return
    this.schema(schema)
  }

  schemaOrdered(schema: NovaSchema<any>): void {
    if (this.schemaBatch(schema, 'ordered')) return
    this.schema(schema)
  }

  save(): void {
    this._writer.save()
  }

  restore(): void {
    this._writer.restore()
  }

  clear(): void {
    this._writer.clear()
  }

  clip(x: number, y: number, width: number, height: number): void {
    this._writer.clip(x, y, width, height)
  }

  clearClip(): void {
    this._writer.clearClip()
  }

  setTransform(matrix: mat3): void {
    this._writer.setTransform(matrix)
  }

  text(params: NovaText): void {
    this.schemaItem({ ...params, type: 'text' })
  }

  rect(params: NovaRect): void {
    this.schemaItem({ ...params, type: 'rect' })
  }

  border(params: NovaBorder): void {
    this.schemaItem({ ...params, type: 'border' })
  }

  line(params: NovaLine): void {
    this.schemaItem({ ...params, type: 'line' })
  }

  circle(params: NovaCircle): void {
    this.schemaItem({ ...params, type: 'circle' })
  }

  polygon(params: NovaPolygon): void {
    this.schemaItem({ ...params, type: 'polygon' })
  }

  icon(params: NovaIcon): void {
    this.schemaItem({ ...params, type: 'icon' })
  }

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

  cursor(type: 'default' | 'pointer' | 'col-resize' | 'row-resize'): void {
    this._writer.cursor(type)
  }

  destroy(): void {
    /* builder does not own GPU resources */
  }

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

  private schemaBatch(schema: NovaSchema<any>, mode: 'batched' | 'ordered'): boolean {
    const items = Array.isArray(schema) ? schema : [schema]
    if (items.length < FAST_SCHEMA_BATCH_THRESHOLD) return false

    this._writer.drawSchemaBatch(items as NovaSchemaItem<any>[], mode)
    return true
  }
}
