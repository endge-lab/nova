import type {
  NovaArc,
  NovaBorder,
  NovaBounds,
  NovaCircle,
  NovaIcon,
  NovaLine,
  NovaPatternRect,
  NovaPolygon,
  NovaRect,
  NovaRectBatch,
  NovaSchema,
  NovaSchemaItem,
  NovaText,
  NovaTimeRangeSegmentBatch,
} from '@/domain/types/renderer.types'
import type { NovaRenderCommandWriter } from '@/model/render/compiler/NovaRenderCommandWriter'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'

/**
 * Предоставляет renderer-facing API для записи schema и primitive intents.
 */
export class NovaRenderContext {
  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    private readonly _writer: NovaRenderCommandWriter,
    private readonly _schemaRegistry: NovaSchemaRegistry,
  ) {}

  /**
   * Выполняет внутреннюю операцию schema.
   */
  schema(schema: NovaSchema<any> | NovaSchemaItem<any>): void {
    const items = Array.isArray(schema) ? schema : [schema]
    for (const item of items) {
      this._schemaItem(item as NovaSchemaItem<any>)
    }
  }

  /**
   * Выполняет внутреннюю операцию rect.
   */
  rect(params: NovaRect): void {
    this._schemaItem({ ...params, type: 'rect' })
  }

  /**
   * Выполняет внутреннюю операцию border.
   */
  border(params: NovaBorder): void {
    this._schemaItem({ ...params, type: 'border' })
  }

  /**
   * Выполняет внутреннюю операцию text.
   */
  text(params: NovaText): void {
    this._schemaItem({ ...params, type: 'text' })
  }

  /**
   * Выполняет внутреннюю операцию line.
   */
  line(params: NovaLine): void {
    this._schemaItem({ ...params, type: 'line' })
  }

  /**
   * Выполняет внутреннюю операцию circle.
   */
  circle(params: NovaCircle): void {
    this._schemaItem({ ...params, type: 'circle' })
  }

  /**
   * Выполняет внутреннюю операцию arc.
   */
  arc(params: NovaArc): void {
    this._schemaItem({ ...params, type: 'arc' })
  }

  /**
   * Выполняет внутреннюю операцию polygon.
   */
  polygon(params: NovaPolygon): void {
    this._schemaItem({ ...params, type: 'polygon' })
  }

  /**
   * Выполняет внутреннюю операцию icon.
   */
  icon(params: NovaIcon): void {
    this._schemaItem({ ...params, type: 'icon' })
  }

  /**
   * Выполняет внутреннюю операцию pattern rect.
   */
  patternRect(params: NovaPatternRect): void {
    this._schemaItem({ ...params, type: 'pattern-rect' })
  }

  /**
   * Записывает retained rect batch.
   */
  rects(batch: NovaRectBatch): void {
    if (batch.active === false || batch.count <= 0) {
      return
    }
    this._writer.drawRectBatch(batch)
  }

  /**
   * Записывает retained time-range segment batch.
   */
  timeRangeSegments(batch: NovaTimeRangeSegmentBatch): void {
    if (batch.active === false || batch.count <= 0) {
      return
    }
    this._writer.drawTimeRangeSegmentBatch(batch)
  }

  /**
   * Выполняет внутреннюю операцию push clip.
   */
  pushClip(rect: NovaBounds): void {
    this._writer.clip(rect.x, rect.y, rect.width, rect.height)
  }

  /**
   * Выполняет внутреннюю операцию pop clip.
   */
  popClip(): void {
    this._writer.clearClip()
  }

  /**
   * Выполняет внутреннюю операцию schema item.
   */
  private _schemaItem(item: NovaSchemaItem<any>): void {
    if (item.active === false) {
      return
    }

    if (item.clip !== undefined && item.clip !== true) {
      this.pushClip(item.clip)
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
      case 'nine-slice-image':
      case 'pattern-rect':
        this._writer.drawSchemaItem(item)
        break
      default:
        this._schemaRegistry.renderSchemaComponent(this as any, item, 'schema')
        break
    }

    if (item.clip !== undefined && item.clip !== true) {
      this.popClip()
    }
  }
}
