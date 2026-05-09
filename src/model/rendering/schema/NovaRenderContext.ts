import type {
  NovaBorder,
  NovaBounds,
  NovaCircle,
  NovaIcon,
  NovaLine,
  NovaPolygon,
  NovaRect,
  NovaSchema,
  NovaSchemaItem,
  NovaText,
} from '@/domain/types/renderer-types'
import type { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'
import type { NovaRenderCommandWriter } from '@/model/rendering/compiler/NovaRenderCommandWriter'

export class NovaRenderContext {
  constructor(
    private readonly _writer: NovaRenderCommandWriter,
    private readonly _schemaRegistry: NovaSchemaRegistry,
  ) {}

  schema(schema: NovaSchema<any> | NovaSchemaItem<any>): void {
    const items = Array.isArray(schema) ? schema : [schema]
    for (const item of items) this.schemaItem(item as NovaSchemaItem<any>)
  }

  rect(params: NovaRect): void {
    this.schemaItem({ ...params, type: 'rect' })
  }

  border(params: NovaBorder): void {
    this.schemaItem({ ...params, type: 'border' })
  }

  text(params: NovaText): void {
    this.schemaItem({ ...params, type: 'text' })
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

  pushClip(rect: NovaBounds): void {
    this._writer.clip(rect.x, rect.y, rect.width, rect.height)
  }

  popClip(): void {
    this._writer.clearClip()
  }

  private schemaItem(item: NovaSchemaItem<any>): void {
    if (item.active === false) return

    if (item.clip !== undefined && item.clip !== true) {
      this.pushClip(item.clip)
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
        this._schemaRegistry.renderSchemaComponent(this as any, item, 'schema')
        break
    }

    if (item.clip !== undefined && item.clip !== true) {
      this.popClip()
    }
  }
}
