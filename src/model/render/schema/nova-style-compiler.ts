import type {
  NovaArc,
  NovaBorder,
  NovaCircle,
  NovaLine,
  NovaPolygon,
  NovaRect,
  NovaStylePadding,
  NovaText,
} from '@/domain/types/renderer.types'
import { parseNovaColor, type NovaParsedColor } from '@/model/render/schema/nova-color-parser'

/**
 * Описывает контракт NovaCompiledBoxStyle.
 */
export interface NovaCompiledBoxStyle {
  fill: NovaParsedColor
  opacity: number
  borderColor: NovaParsedColor
  borderWidth: number
  borderRadius: number
  dashPattern?: Array<number>
}

/**
 * Описывает контракт NovaCompiledTextStyle.
 */
export interface NovaCompiledTextStyle {
  color: NovaParsedColor
  opacity: number
  font: string
  fontSize: number
  lineHeight: number
  padding: Required<NovaCompiledPadding>
  horizontalAlign: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  overflowAlign: 'start' | 'preserve'
  ellipsis: boolean
}

/**
 * Описывает контракт NovaCompiledArcStyle.
 */
export interface NovaCompiledArcStyle {
  color: NovaParsedColor
  width: number
  opacity: number
  lineCap: 'butt' | 'round' | 'square'
}

/**
 * Описывает контракт NovaCompiledPadding.
 */
export interface NovaCompiledPadding {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Компилирует nova rect style.
 */
export function compileNovaRectStyle(rect: NovaRect): NovaCompiledBoxStyle {
  const background = typeof rect.styles?.background === 'string' ? rect.styles.background : undefined
  return {
    fill: parseNovaColor(background, 0x00000000),
    opacity: rect.styles?.opacity ?? 1,
    borderColor: parseNovaColor(rect.styles?.border?.color, 0x00000000),
    borderWidth: rect.styles?.border?.width ?? 0,
    borderRadius: rect.styles?.radius ?? rect.styles?.border?.radius ?? 0,
    dashPattern: rect.styles?.border?.dashPattern,
  }
}

/**
 * Компилирует nova border style.
 */
export function compileNovaBorderStyle(border: NovaBorder): NovaCompiledBoxStyle {
  return {
    fill: parseNovaColor(undefined, 0x00000000),
    opacity: 1,
    borderColor: parseNovaColor(border.styles?.color, 0x000000ff),
    borderWidth: border.styles?.width ?? 1,
    borderRadius: border.styles?.radius ?? 0,
    dashPattern: border.styles?.dashPattern,
  }
}

/**
 * Компилирует nova circle style.
 */
export function compileNovaCircleStyle(circle: NovaCircle): NovaCompiledBoxStyle {
  const background = typeof circle.styles?.background === 'string' ? circle.styles.background : undefined
  return {
    fill: parseNovaColor(background, 0x00000000),
    opacity: circle.styles?.opacity ?? 1,
    borderColor: parseNovaColor(circle.styles?.border?.color, 0x00000000),
    borderWidth: circle.styles?.border?.width ?? 0,
    borderRadius: circle.radius,
    dashPattern: circle.styles?.border?.dashPattern,
  }
}

/**
 * Компилирует nova arc style.
 */
export function compileNovaArcStyle(arc: NovaArc): NovaCompiledArcStyle {
  return {
    color: parseNovaColor(arc.styles?.color, 0x000000ff),
    width: arc.styles?.width ?? 1,
    opacity: arc.styles?.opacity ?? 1,
    lineCap: arc.styles?.lineCap ?? 'butt',
  }
}

/**
 * Компилирует nova line style.
 */
export function compileNovaLineStyle(line: NovaLine): { color: NovaParsedColor; width: number; opacity: number; dashPattern?: Array<number> } {
  return {
    color: parseNovaColor(line.styles?.color, 0x000000ff),
    width: line.styles?.width ?? 1,
    opacity: line.styles?.opacity ?? 1,
    dashPattern: line.styles?.dashPattern,
  }
}

/**
 * Компилирует nova polygon style.
 */
export function compileNovaPolygonStyle(polygon: NovaPolygon): {
  fill: NovaParsedColor
  stroke: NovaParsedColor
  lineWidth: number
  opacity: number
} {
  return {
    fill: parseNovaColor(polygon.styles?.background, 0x00000000),
    stroke: parseNovaColor(polygon.styles?.stroke, 0x00000000),
    lineWidth: polygon.styles?.lineWidth ?? 0,
    opacity: polygon.styles?.opacity ?? 1,
  }
}

/**
 * Компилирует nova text style.
 */
export function compileNovaTextStyle(text: NovaText): NovaCompiledTextStyle {
  const font = text.styles?.font
  const fontSize = font?.size ?? 12
  const fontStyle = font?.style ?? 'normal'
  const fontWeight = font?.weight ?? 'normal'
  const fontFamily = font?.family ?? 'sans-serif'

  return {
    color: parseNovaColor(text.styles?.color, 0x000000ff),
    opacity: text.styles?.opacity ?? 1,
    font: `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`,
    fontSize,
    lineHeight: text.styles?.lineHeight ?? fontSize,
    padding: compileNovaPadding(text.styles?.padding),
    horizontalAlign: text.styles?.align?.horizontal ?? 'left',
    verticalAlign: text.styles?.align?.vertical ?? 'top',
    overflowAlign: text.styles?.align?.overflow ?? 'start',
    ellipsis: text.styles?.ellipsis ?? false,
  }
}

/**
 * Компилирует nova padding.
 */
export function compileNovaPadding(padding?: NovaStylePadding): Required<NovaCompiledPadding> {
  if (!padding) return { left: 0, right: 0, top: 0, bottom: 0 }
  if ('all' in padding) {
    const value = padding.all ?? 0
    return { left: value, right: value, top: value, bottom: value }
  }
  if ('horizontal' in padding || 'vertical' in padding) {
    return {
      left: padding.horizontal ?? 0,
      right: padding.horizontal ?? 0,
      top: padding.vertical ?? 0,
      bottom: padding.vertical ?? 0,
    }
  }

  const sidePadding = padding as Partial<NovaCompiledPadding>
  return {
    left: sidePadding.left ?? 0,
    right: sidePadding.right ?? 0,
    top: sidePadding.top ?? 0,
    bottom: sidePadding.bottom ?? 0,
  }
}
