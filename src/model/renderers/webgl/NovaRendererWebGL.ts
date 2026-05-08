import { randomString } from '@endge/utils'
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
  NovaText,
} from '@/domain/types/renderer-types'
import type { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'

const WEBGL_NOT_IMPLEMENTED_MESSAGE =
  'NovaRendererWebGL is not implemented yet. Use RendererType.WebGLOld for the current legacy WebGL backend.'

export class NovaRendererWebGL implements NovaRenderer {
  readonly id: string = randomString(5)
  readonly novaCanvas: NovaCanvas
  readonly capabilities: NovaRendererCapabilities = {
    canvas2d: false,
    webgl: true,
    schema: false,
    rect: false,
    border: false,
    line: false,
    circle: false,
    polygon: false,
    icon: false,
    text: false,
    measureText: false,
  }

  constructor(novaCanvas: NovaCanvas) {
    this.novaCanvas = novaCanvas
    this.notImplemented()
  }

  schema(_schema: NovaSchema<any>): void {
    this.notImplemented()
  }

  schemaBatched(_schema: NovaSchema<any>): void {
    this.notImplemented()
  }

  schemaOrdered(_schema: NovaSchema<any>): void {
    this.notImplemented()
  }

  save(): void {
    this.notImplemented()
  }

  restore(): void {
    this.notImplemented()
  }

  clear(): void {
    this.notImplemented()
  }

  clip(_x: number, _y: number, _width: number, _height: number): void {
    this.notImplemented()
  }

  clearClip(): void {
    this.notImplemented()
  }

  setTransform(_matrix: mat3): void {
    this.notImplemented()
  }

  text(_params: NovaText): void {
    this.notImplemented()
  }

  rect(_params: NovaRect): void {
    this.notImplemented()
  }

  border(_params: NovaBorder): void {
    this.notImplemented()
  }

  line(_params: NovaLine): void {
    this.notImplemented()
  }

  circle(_params: NovaCircle): void {
    this.notImplemented()
  }

  polygon(_params: NovaPolygon): void {
    this.notImplemented()
  }

  icon(_params: NovaIcon): void {
    this.notImplemented()
  }

  measureText(_params: NovaText): { width: number; height: number } {
    this.notImplemented()
  }

  cursor(_type: 'default' | 'pointer' | 'col-resize' | 'row-resize'): void {
    this.notImplemented()
  }

  destroy(): void {
    /* no resources until the new renderer is implemented */
  }

  private notImplemented(): never {
    throw new Error(WEBGL_NOT_IMPLEMENTED_MESSAGE)
  }
}
