import type { mat3 } from 'gl-matrix'
import type { NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { NovaRenderer, NovaSchema, NovaSchemaItem } from '@/domain/types/renderer-types'
import { NovaWebGLBatcher } from '@/model/renderers/webgl/NovaWebGLBatcher'

export class NovaWebGLFrameRenderer {
  private readonly _batcher = new NovaWebGLBatcher()

  constructor(private readonly _target: NovaRenderer) {}

  render(frame: NovaRenderFrame): NovaRenderMetrics {
    const startedAt = performance.now()
    const itemMap = new Map(frame.items.map(item => [item.id, item]))
    const schemaBatch: NovaSchema<any> = []
    let drawCalls = 0

    const flushSchema = (): void => {
      if (schemaBatch.length === 0) return
      this._target.schemaBatched(schemaBatch)
      schemaBatch.length = 0
      drawCalls += 1
    }

    this._target.clear()

    for (const command of [...frame.commands].sort((a, b) => a.order - b.order)) {
      switch (command.type) {
        case 'clear':
          flushSchema()
          this._target.clear()
          break
        case 'save':
          flushSchema()
          this._target.save()
          break
        case 'restore':
          flushSchema()
          this._target.restore()
          break
        case 'setTransform':
          flushSchema()
          this._target.setTransform(command.transform as mat3)
          break
        case 'clip':
          flushSchema()
          if (command.clip) this._target.clip(command.clip.x, command.clip.y, command.clip.width, command.clip.height)
          break
        case 'clearClip':
          flushSchema()
          this._target.clearClip()
          break
        case 'cursor':
          if (command.cursor) this._target.cursor(command.cursor)
          break
        case 'drawItem': {
          const item = command.itemId ? itemMap.get(command.itemId) : undefined
          if (item?.schemaItem) schemaBatch.push(item.schemaItem as NovaSchemaItem<any>)
          break
        }
        default:
          break
      }
    }

    flushSchema()

    const batches = this._batcher.buildDisplayOrderBatches(frame.items).length
    const backendMs = performance.now() - startedAt
    return {
      ...frame.metrics,
      backendMs,
      drawMs: backendMs,
      drawCalls,
      batches,
    }
  }
}
