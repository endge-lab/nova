import type { NovaCanvas } from '@/domain/entities/graphics/NovaCanvas'
import type {
  NovaBorder,
  NovaCircle,
  NovaIcon,
  NovaLine,
  NovaPolygon,
  NovaRect,
  NovaRenderer,
  NovaRendererCapabilities,
  NovaRenderQueueStats,
  NovaSchema,
  NovaText,
} from '@/domain/types/renderer-types'
import { randomString } from '@endge/utils'
import { mat3 } from 'gl-matrix'

type NovaRenderQueueSchemaCommand = {
  type: 'schema'
  matrix: mat3
  matrixKey: string
  schema: NovaSchema
}

type NovaRenderQueueControlCommand =
  | { type: 'clear' }
  | { type: 'clip'; matrix: mat3; x: number; y: number; width: number; height: number }
  | { type: 'clearClip' }
  | { type: 'cursor'; cursor: 'default' | 'pointer' | 'col-resize' | 'row-resize' }

type NovaRenderQueueCommand = NovaRenderQueueSchemaCommand | NovaRenderQueueControlCommand
export type NovaRenderQueueSnapshot = Array<NovaRenderQueueCommand>

const EMPTY_STATS: NovaRenderQueueStats = {
  commands: 0,
  items: 0,
  batches: 0,
}

export class NovaRenderQueueRenderer implements NovaRenderer {
  readonly id: string = randomString(5)

  private _target: NovaRenderer
  private readonly _commands: NovaRenderQueueCommand[] = []
  private readonly _matrixStack: mat3[] = []
  private _matrix = mat3.create()
  private _stats: NovaRenderQueueStats = { ...EMPTY_STATS }

  constructor(target: NovaRenderer) {
    this._target = target
  }

  setTarget(target: NovaRenderer): void {
    this._target = target
    this.clearQueue()
  }

  clearQueue(): void {
    this._commands.length = 0
    this._matrixStack.length = 0
    mat3.identity(this._matrix)
    this._stats = { ...EMPTY_STATS }
  }

  beginSnapshot(): number {
    return this._commands.length
  }

  endSnapshot(start: number): NovaRenderQueueSnapshot {
    return this._commands.slice(start)
  }

  appendSnapshot(snapshot: NovaRenderQueueSnapshot): void {
    this._commands.push(...snapshot)
  }

  flush(): NovaRenderQueueStats {
    let batchMatrix: mat3 | null = null
    let batchKey = ''
    let batchSchema: NovaSchema = []
    const stats: NovaRenderQueueStats = {
      commands: this._commands.length,
      items: 0,
      batches: 0,
    }

    const flushBatch = (): void => {
      if (!batchMatrix || batchSchema.length === 0) return

      this._target.save()
      this._target.setTransform(batchMatrix)
      this._target.schemaOrdered(batchSchema)
      this._target.restore()
      stats.items += batchSchema.length
      stats.batches += 1
      batchSchema = []
      batchMatrix = null
      batchKey = ''
    }

    for (const command of this._commands) {
      if (command.type === 'schema') {
        if (batchKey !== command.matrixKey) {
          flushBatch()
          batchKey = command.matrixKey
          batchMatrix = command.matrix
        }

        batchSchema.push(...command.schema)
        continue
      }

      flushBatch()

      if (command.type === 'clear') {
        this._target.clear()
      } else if (command.type === 'clip') {
        this._target.setTransform(command.matrix)
        this._target.clip(command.x, command.y, command.width, command.height)
      } else if (command.type === 'clearClip') {
        this._target.clearClip()
      } else if (command.type === 'cursor') {
        this._target.cursor(command.cursor)
      }
    }

    flushBatch()
    this._stats = stats
    this.clearQueue()
    this._stats = stats
    return stats
  }

  schema(schema: NovaSchema): void {
    this.enqueueSchema(schema)
  }

  schemaBatched(schema: NovaSchema): void {
    this.enqueueSchema(schema)
  }

  schemaOrdered(schema: NovaSchema): void {
    this.enqueueSchema(schema)
  }

  save(): void {
    this._matrixStack.push(mat3.clone(this._matrix))
  }

  restore(): void {
    const matrix = this._matrixStack.pop()
    if (matrix) this._matrix = matrix
  }

  clear(): void {
    this._commands.push({ type: 'clear' })
  }

  clip(x: number, y: number, width: number, height: number): void {
    this._commands.push({
      type: 'clip',
      matrix: mat3.clone(this._matrix),
      x,
      y,
      width,
      height,
    })
  }

  clearClip(): void {
    this._commands.push({ type: 'clearClip' })
  }

  setTransform(matrix: mat3): void {
    this._matrix = mat3.clone(matrix)
  }

  text(params: NovaText): void {
    this.enqueueSchema([{ type: 'text', ...params }])
  }

  rect(params: NovaRect): void {
    this.enqueueSchema([{ type: 'rect', ...params }])
  }

  border(params: NovaBorder): void {
    this.enqueueSchema([{ type: 'border', ...params }])
  }

  line(params: NovaLine): void {
    this.enqueueSchema([{ type: 'line', ...params }])
  }

  circle(params: NovaCircle): void {
    this.enqueueSchema([{ type: 'circle', ...params }])
  }

  polygon(params: NovaPolygon): void {
    this.enqueueSchema([{ type: 'polygon', ...params }])
  }

  icon(params: NovaIcon): void {
    this.enqueueSchema([{ type: 'icon', ...params }])
  }

  measureText(params: NovaText): { width: number; height: number } {
    return this._target.measureText(params)
  }

  cursor(cursor: 'default' | 'pointer' | 'col-resize' | 'row-resize'): void {
    this._commands.push({ type: 'cursor', cursor })
  }

  destroy(): void {
    this.clearQueue()
  }

  private enqueueSchema(schema: NovaSchema): void {
    if (schema.length === 0) return

    this._commands.push({
      type: 'schema',
      matrix: mat3.clone(this._matrix),
      matrixKey: matrixKey(this._matrix),
      schema: schema.slice(),
    })
  }

  get novaCanvas(): NovaCanvas {
    return this._target.novaCanvas
  }

  get capabilities(): NovaRendererCapabilities {
    return this._target.capabilities
  }

  get stats(): NovaRenderQueueStats {
    return this._stats
  }
}

function matrixKey(matrix: mat3): string {
  return `${matrix[0]},${matrix[1]},${matrix[2]},${matrix[3]},${matrix[4]},${matrix[5]},${matrix[6]},${matrix[7]},${matrix[8]}`
}
