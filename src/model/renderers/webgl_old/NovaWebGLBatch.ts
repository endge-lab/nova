import type { NovaRect } from '@/domain/types/renderer-types'

export type NovaWebGLBatchType = 'fill' | 'border'

export class NovaWebGLBatch {
  rects: NovaRect[] = []
  color: string
  rectCount = 0
  private _vertices = new Float32Array(0)
  private _vertexLength = 0

  constructor(color: string) {
    this.color = color
  }

  get vertices(): Float32Array {
    return this._vertices.subarray(0, this._vertexLength)
  }

  add(rect: NovaRect): void {
    this.rects.push(rect)
    this.addRect(rect.x, rect.y, rect.width, rect.height)
  }

  addRect(x: number, y: number, width: number, height: number): void {
    if (width <= 0 || height <= 0) return

    const offset = this._vertexLength
    this.ensureCapacity(offset + 12)

    const x2 = x + width
    const y2 = y + height
    const vertices = this._vertices
    vertices[offset] = x
    vertices[offset + 1] = y
    vertices[offset + 2] = x2
    vertices[offset + 3] = y
    vertices[offset + 4] = x
    vertices[offset + 5] = y2
    vertices[offset + 6] = x
    vertices[offset + 7] = y2
    vertices[offset + 8] = x2
    vertices[offset + 9] = y
    vertices[offset + 10] = x2
    vertices[offset + 11] = y2

    this._vertexLength += 12
    this.rectCount += 1
  }

  clear(): void {
    this.rects.length = 0
    this._vertexLength = 0
    this.rectCount = 0
  }

  private ensureCapacity(size: number): void {
    if (this._vertices.length >= size) return

    let nextSize = this._vertices.length || 1024
    while (nextSize < size) {
      nextSize *= 2
    }

    const next = new Float32Array(nextSize)
    next.set(this._vertices)
    this._vertices = next
  }
}
