import { describe, expect, it, vi } from 'vitest'
import { mat3 } from 'gl-matrix'
import { NovaRenderQueueRenderer } from '@/domain/entities/graphics/NovaRenderQueueRenderer'
import type { NovaCanvas } from '@/domain/entities/graphics/NovaCanvas'
import type {
  NovaRenderer,
  NovaRendererCapabilities,
  NovaSchema,
  NovaText,
} from '@/domain/types/renderer-types'

function createRendererSpy(): NovaRenderer & {
  calls: string[]
  schemas: NovaSchema[]
} {
  const calls: string[] = []
  const schemas: NovaSchema[] = []
  const capabilities: NovaRendererCapabilities = {
    canvas2d: true,
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

  return {
    id: 'target',
    novaCanvas: {} as NovaCanvas,
    capabilities,
    calls,
    schemas,
    schema: (schema) => {
      calls.push(`schema:${schema.length}`)
      schemas.push(schema)
    },
    schemaBatched: (schema) => {
      calls.push(`schemaBatched:${schema.length}`)
      schemas.push(schema)
    },
    schemaOrdered: (schema) => {
      calls.push(`schemaOrdered:${schema.length}`)
      schemas.push(schema)
    },
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    clear: () => calls.push('clear'),
    clip: (x, y, width, height) => calls.push(`clip:${x}:${y}:${width}:${height}`),
    clearClip: () => calls.push('clearClip'),
    setTransform: (matrix) => calls.push(`matrix:${matrix[6]}:${matrix[7]}`),
    text: () => calls.push('text'),
    rect: () => calls.push('rect'),
    border: () => calls.push('border'),
    line: () => calls.push('line'),
    circle: () => calls.push('circle'),
    polygon: () => calls.push('polygon'),
    icon: () => calls.push('icon'),
    measureText: (params: NovaText) => ({ width: params.text.length * 8, height: params.height }),
    cursor: (type) => calls.push(`cursor:${type}`),
    destroy: vi.fn(),
  }
}

describe('NovaRenderQueueRenderer', () => {
  it('flushes adjacent schema commands with the same transform as one ordered batch', () => {
    const target = createRendererSpy()
    const queue = new NovaRenderQueueRenderer(target)

    queue.schema([{ type: 'rect', x: 0, y: 0, width: 10, height: 10 }])
    queue.rect({ x: 10, y: 0, width: 10, height: 10 })

    const stats = queue.flush()

    expect(stats).toEqual({ commands: 2, items: 2, batches: 1 })
    expect(target.schemas).toHaveLength(1)
    expect(target.schemas[0]).toHaveLength(2)
    expect(target.calls).toEqual(['save', 'matrix:0:0', 'schemaOrdered:2', 'restore'])
  })

  it('keeps order when transform changes between nodes', () => {
    const target = createRendererSpy()
    const queue = new NovaRenderQueueRenderer(target)
    const shifted = mat3.create()
    mat3.translate(shifted, shifted, [40, 12])

    queue.rect({ x: 0, y: 0, width: 10, height: 10 })
    queue.save()
    queue.setTransform(shifted)
    queue.rect({ x: 0, y: 0, width: 20, height: 20 })
    queue.restore()
    queue.rect({ x: 30, y: 0, width: 10, height: 10 })

    const stats = queue.flush()

    expect(stats).toEqual({ commands: 3, items: 3, batches: 3 })
    expect(target.calls).toEqual([
      'save',
      'matrix:0:0',
      'schemaOrdered:1',
      'restore',
      'save',
      'matrix:40:12',
      'schemaOrdered:1',
      'restore',
      'save',
      'matrix:0:0',
      'schemaOrdered:1',
      'restore',
    ])
  })

  it('delegates measurement immediately and replays control commands in order', () => {
    const target = createRendererSpy()
    const queue = new NovaRenderQueueRenderer(target)

    expect(queue.measureText({ text: 'ABC', x: 0, y: 0, width: 100, height: 20 }).width).toBe(24)

    queue.clip(1, 2, 3, 4)
    queue.rect({ x: 0, y: 0, width: 10, height: 10 })
    queue.clearClip()
    queue.cursor('pointer')
    queue.flush()

    expect(target.calls).toEqual([
      'matrix:0:0',
      'clip:1:2:3:4',
      'save',
      'matrix:0:0',
      'schemaOrdered:1',
      'restore',
      'clearClip',
      'cursor:pointer',
    ])
  })
})
