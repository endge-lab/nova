import type { DataRect } from '@endge/utils'
import type { NovaSemanticSnapshot } from '@/domain/types/semantic.types'

export type NovaExportFormat = 'png' | 'webp'

export interface NovaExportImageOptions {
  format?: NovaExportFormat
  quality?: number
  pixelRatio?: number
  rect?: DataRect
  background?: string
  preferBlob?: boolean
  includeSemanticSnapshot?: boolean
}

export interface NovaExportImageResult {
  format: NovaExportFormat
  width: number
  height: number
  pixelRatio: number
  dataUrl?: string
  blob?: Blob
  byteLength?: number
  semanticSnapshot?: NovaSemanticSnapshot
}

export type NovaExportErrorCode
  = | 'unsupported-format'
    | 'tainted-canvas'
    | 'context-lost'
    | 'empty-canvas'

export class NovaExportError extends Error {
  readonly code: NovaExportErrorCode

  constructor(code: NovaExportErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'NovaExportError'
    this.code = code
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}
