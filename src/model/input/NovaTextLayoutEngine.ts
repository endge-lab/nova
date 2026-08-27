import type {
  NovaRectLike,
  NovaTextInputAlign,
  NovaTextInputLayoutOptions,
  NovaTextInputLayoutResult,
  NovaTextLayoutGlyph,
  NovaTextLayoutLine,
  NovaTextMeasureContext,
} from '@/model/input/nova-input.types'

interface PaddingBox {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Описывает ответственность NovaTextLayoutEngine в архитектуре проекта.
 */
export class NovaTextLayoutEngine {
  /**
   * Выполняет действие layout в рамках ответственности NovaTextLayoutEngine.
   */
  layout(options: NovaTextInputLayoutOptions): NovaTextInputLayoutResult {
    return layoutNovaTextInput(options)
  }

  /**
   * Выполняет действие coordinateToIndex в рамках ответственности NovaTextLayoutEngine.
   */
  coordinateToIndex(layout: NovaTextInputLayoutResult, x: number, y: number): number {
    return novaTextIndexAtPoint(layout, x, y)
  }

  /**
   * Выполняет действие caretRect в рамках ответственности NovaTextLayoutEngine.
   */
  caretRect(layout: NovaTextInputLayoutResult, index: number): NovaRectLike {
    return novaCaretRectAtIndex(layout, index)
  }

  /**
   * Обновляет состояние выбора NovaTextLayoutEngine.
   */
  selectionRects(layout: NovaTextInputLayoutResult, start: number, end: number): Array<NovaRectLike> {
    return novaSelectionRects(layout, start, end)
  }
}

export function layoutNovaTextInput(options: NovaTextInputLayoutOptions): NovaTextInputLayoutResult {
  const padding = normalizePadding(options.padding)
  const fontSize = finite(options.fontSize, 13)
  const lineHeight = finite(options.lineHeight, Math.round(fontSize * 1.45))
  const charWidth = finite(options.charWidth, fontSize * 0.58)
  const fontFamily = options.fontFamily ?? 'sans-serif'
  const fontWeight = options.fontWeight ?? 'normal'
  const fontStyle = options.fontStyle ?? 'normal'
  const tabSize = Math.max(1, Math.floor(finite(options.tabSize, 4)))
  const width = Math.max(0, finite(options.width, 0))
  const height = Math.max(0, finite(options.height, 0))
  const contentX = padding.left
  const contentY = padding.top
  const contentWidth = Math.max(0, width - padding.left - padding.right)
  const contentHeight = Math.max(0, height - padding.top - padding.bottom)
  const multiline = options.multiline ?? false
  const wrap = multiline ? options.wrap ?? true : false
  const align = normalizeAlign(options.align)
  const scrollX = Math.max(0, finite(options.scrollX, 0))
  const scrollY = Math.max(0, finite(options.scrollY, 0))
  const measureContext: NovaTextMeasureContext = {
    fontSize,
    lineHeight,
    fontFamily,
    fontWeight,
    fontStyle,
    charWidth,
    tabSize,
  }
  const glyphs: Array<NovaTextLayoutGlyph> = []
  const lines: Array<NovaTextLayoutLine> = []
  const text = String(options.text ?? '')
  const segments = splitGraphemes(text)
  const maxLineWidth = wrap ? Math.max(charWidth, contentWidth) : Number.POSITIVE_INFINITY

  let lineIndex = 0
  let lineStart = 0
  let lineText = ''
  let lineWidth = 0
  let x = contentX - scrollX
  let y = contentY - scrollY

  const flushLine = (end: number) => {
    const lineX = contentX + resolveAlignOffset(align, lineWidth, contentWidth, scrollX) - scrollX
    const dx = lineX - (contentX - scrollX)
    if (dx !== 0) {
      for (const glyph of glyphs) {
        if (glyph.line === lineIndex) {
          glyph.x += dx
        }
      }
    }
    lines.push({
      index: lineIndex,
      start: lineStart,
      end,
      x: lineX,
      y,
      width: lineWidth,
      height: lineHeight,
      text: lineText,
    })
    lineIndex += 1
    lineStart = end
    lineText = ''
    lineWidth = 0
    x = contentX - scrollX
    y = contentY + lineIndex * lineHeight - scrollY
  }

  for (const segment of segments) {
    if (segment.value === '\n' && multiline) {
      flushLine(segment.index)
      lineStart = segment.end
      continue
    }
    const rawWidth = measureSegmentWidth(segment.value, measureContext, options.measureText)
    if (wrap && lineWidth > 0 && lineWidth + rawWidth > maxLineWidth) {
      flushLine(segment.index)
      lineStart = segment.index
    }
    glyphs.push({
      value: segment.value,
      index: segment.index,
      end: segment.end,
      x,
      y,
      width: rawWidth,
      height: lineHeight,
      line: lineIndex,
    })
    x += rawWidth
    lineWidth += rawWidth
    lineText += segment.value
  }

  flushLine(text.length)

  return {
    text,
    width,
    height,
    contentX,
    contentY,
    contentWidth,
    contentHeight,
    scrollX,
    scrollY,
    fontSize,
    lineHeight,
    charWidth,
    multiline,
    wrap,
    lines,
    glyphs,
  }
}

export function novaTextIndexAtPoint(layout: NovaTextInputLayoutResult, x: number, y: number): number {
  const line = layout.lines.find(candidate => y >= candidate.y && y < candidate.y + candidate.height)
    ?? nearestLine(layout, y)
  if (!line) {
    return 0
  }
  const lineGlyphs = layout.glyphs.filter(glyph => glyph.line === line.index)
  if (lineGlyphs.length === 0) {
    return line.start
  }
  for (const glyph of lineGlyphs) {
    if (x < glyph.x + glyph.width / 2) {
      return glyph.index
    }
    if (x < glyph.x + glyph.width) {
      return glyph.end
    }
  }
  return line.end
}

export function novaCaretRectAtIndex(layout: NovaTextInputLayoutResult, index: number): NovaRectLike {
  const clamped = clampIndex(index, layout.text.length)
  const glyph = layout.glyphs.find(candidate => clamped >= candidate.index && clamped < candidate.end)
  if (glyph) {
    const offset = clamped === glyph.end ? glyph.width : 0
    return {
      x: glyph.x + offset,
      y: glyph.y + 2,
      width: 1,
      height: Math.max(1, glyph.height - 4),
    }
  }
  const exactLine = layout.lines.find(line => clamped === line.start && line.start === line.end)
  if (exactLine) {
    return {
      x: exactLine.x,
      y: exactLine.y + 2,
      width: 1,
      height: Math.max(1, exactLine.height - 4),
    }
  }
  const previous = [...layout.glyphs].reverse().find(candidate => candidate.end <= clamped)
  if (previous) {
    return {
      x: previous.x + previous.width,
      y: previous.y + 2,
      width: 1,
      height: Math.max(1, previous.height - 4),
    }
  }
  const firstLine = layout.lines[0]
  return {
    x: firstLine?.x ?? layout.contentX - layout.scrollX,
    y: (firstLine?.y ?? layout.contentY) + 2,
    width: 1,
    height: Math.max(1, layout.lineHeight - 4),
  }
}

export function novaSelectionRects(layout: NovaTextInputLayoutResult, start: number, end: number): Array<NovaRectLike> {
  const from = Math.min(clampIndex(start, layout.text.length), clampIndex(end, layout.text.length))
  const to = Math.max(clampIndex(start, layout.text.length), clampIndex(end, layout.text.length))
  if (from === to) {
    return []
  }

  const rects: Array<NovaRectLike> = []
  for (const line of layout.lines) {
    const lineFrom = Math.max(from, line.start)
    const lineTo = Math.min(to, line.end)
    if (lineFrom >= lineTo) {
      continue
    }
    const a = novaCaretRectAtIndex(layout, lineFrom)
    const b = novaCaretRectAtIndex(layout, lineTo)
    const x = Math.min(a.x, b.x)
    const width = Math.max(2, Math.abs(b.x - a.x))
    const clippedX = Math.max(layout.contentX, x)
    const clippedRight = Math.min(layout.contentX + layout.contentWidth, x + width)
    if (clippedRight <= clippedX) {
      continue
    }
    rects.push({
      x: clippedX,
      y: Math.max(layout.contentY, line.y + 2),
      width: clippedRight - clippedX,
      height: Math.min(layout.contentY + layout.contentHeight, line.y + line.height - 2) - Math.max(layout.contentY, line.y + 2),
    })
  }
  return rects.filter(rect => rect.height > 0)
}

export function splitGraphemes(text: string): Array<{ value: string, index: number, end: number }> {
  const Segmenter = typeof Intl !== 'undefined' ? (Intl as any).Segmenter : undefined
  const segmenter = Segmenter
    ? new Segmenter(undefined, { granularity: 'grapheme' })
    : null
  if (!segmenter) {
    let index = 0
    return Array.from(text).map((value) => {
      const start = index
      index += value.length
      return { value, index: start, end: index }
    })
  }
  return Array.from(segmenter.segment(text) as Iterable<{ segment: string, index: number }>, segment => ({
    value: segment.segment,
    index: segment.index,
    end: segment.index + segment.segment.length,
  }))
}

function nearestLine(layout: NovaTextInputLayoutResult, y: number): NovaTextLayoutLine | undefined {
  if (layout.lines.length === 0) {
    return undefined
  }
  if (y <= layout.lines[0].y) {
    return layout.lines[0]
  }
  return layout.lines[layout.lines.length - 1]
}

function measureSegmentWidth(
  value: string,
  context: NovaTextMeasureContext,
  measureText?: NovaTextInputLayoutOptions['measureText'],
): number {
  if (value === '\t') {
    return context.charWidth * context.tabSize
  }
  const fallback = Math.max(0, value.length * context.charWidth)
  if (!measureText) {
    return fallback
  }
  return Math.max(0, finite(measureText(value, context), fallback))
}

function resolveAlignOffset(
  align: NovaTextInputAlign,
  lineWidth: number,
  contentWidth: number,
  scrollX: number,
): number {
  if (scrollX > 0) {
    return 0
  }
  if (lineWidth > contentWidth) {
    return 0
  }
  if (align === 'center') {
    return (contentWidth - lineWidth) / 2
  }
  if (align === 'right') {
    return contentWidth - lineWidth
  }
  return 0
}

function normalizeAlign(value: unknown): NovaTextInputAlign {
  if (value === 'center' || value === 'right') {
    return value
  }
  return 'left'
}

function normalizePadding(value: NovaTextInputLayoutOptions['padding']): PaddingBox {
  if (typeof value === 'number') {
    return { top: value, right: value, bottom: value, left: value }
  }
  return {
    top: value?.top ?? value?.vertical ?? 0,
    right: value?.right ?? value?.horizontal ?? 0,
    bottom: value?.bottom ?? value?.vertical ?? 0,
    left: value?.left ?? value?.horizontal ?? 0,
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampIndex(index: number, max: number): number {
  return Math.max(0, Math.min(max, Math.floor(index)))
}
