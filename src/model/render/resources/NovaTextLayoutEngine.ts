import type { NovaText } from '@/domain/types/renderer.types'

/**
 * Описывает контракт NovaTextLayoutMeasure.
 */
export interface NovaTextLayoutMeasure {
  width: number
  height: number
  fontKey: string
}

/**
 * Выполняет layout text runs перед rasterization и batching.
 */
export class NovaTextLayoutEngine {
  private readonly _canvas = document.createElement('canvas')

  /**
   * Выполняет внутреннюю операцию measure.
   */
  measure(text: NovaText, scale = 1): NovaTextLayoutMeasure {
    const context = this.getContext2D()
    const font = text.styles?.font
    const size = (font?.size ?? 12) * scale
    const family = font?.family ?? 'sans-serif'
    const style = font?.style ?? 'normal'
    const weight = font?.weight ?? 'normal'
    const fontKey = `${style}:${weight}:${size}:${family}`

    if (context) {
      context.font = `${style} ${weight} ${size}px ${family}`
    }

    return {
      width: Math.ceil(context?.measureText(text.text).width ?? text.text.length * size * 0.6),
      height: Math.ceil((text.styles?.lineHeight ?? font?.size ?? 12) * scale),
      fontKey,
    }
  }

  /**
   * Возвращает context2 d.
   */
  private getContext2D(): CanvasRenderingContext2D | null {
    if (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')) {
      return null
    }

    try {
      return this._canvas.getContext('2d')
    }
    catch {
      return null
    }
  }
}
