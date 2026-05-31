import type { NovaTextFont } from '@/domain/types/renderer.types'

type NovaResolvedTextFont = NonNullable<NovaTextFont>

export type NovaInputEngine = 'canvas' | 'proxy' | 'auto'
export type NovaInputState = 'idle' | 'hovered' | 'focused' | 'disabled' | 'invalid' | 'readonly'
export type NovaInputValidationResult = true | string | { message: string; code?: string }

export interface NovaTextSelection {
  start: number
  end: number
  direction?: 'forward' | 'backward' | 'none'
}

export interface NovaTextRange {
  start: number
  end: number
}

export interface NovaRectLike {
  x: number
  y: number
  width: number
  height: number
}

export interface NovaTextInputContext {
  reason?: string
  event?: Event
}

export interface NovaTextInputSnapshot {
  value: string
  draft: string
  selectionStart: number
  selectionEnd: number
  focused: boolean
  composing: boolean
  dirty: boolean
  readonly: boolean
  disabled: boolean
}

export interface NovaTextInputControllerOptions {
  value?: string | number
  defaultValue?: string | number
  multiline?: boolean
  readonly?: boolean
  disabled?: boolean
  maxLength?: number
  historyLimit?: number
  onValueChange?: (value: string, context: NovaTextInputContext) => void
  onCommit?: (value: string, context: NovaTextInputContext) => void
  onCancel?: (context: NovaTextInputContext) => void
}

export interface NovaTextMeasureOptions {
  fontSize?: number
  lineHeight?: number
  fontFamily?: string
  fontWeight?: NovaResolvedTextFont['weight']
  fontStyle?: NovaResolvedTextFont['style']
  charWidth?: number
  tabSize?: number
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number; horizontal?: number; vertical?: number }
  measureText?: NovaTextMeasureFn
}

export type NovaTextInputAlign = 'left' | 'center' | 'right'

export interface NovaTextMeasureContext {
  fontSize: number
  lineHeight: number
  fontFamily: string
  fontWeight: NovaResolvedTextFont['weight']
  fontStyle: NovaResolvedTextFont['style']
  charWidth: number
  tabSize: number
}

export type NovaTextMeasureFn = (text: string, context: NovaTextMeasureContext) => number

export interface NovaTextInputLayoutOptions extends NovaTextMeasureOptions {
  text: string
  width: number
  height: number
  multiline?: boolean
  wrap?: boolean
  align?: NovaTextInputAlign
  scrollX?: number
  scrollY?: number
}

export interface NovaTextLayoutGlyph {
  value: string
  index: number
  end: number
  x: number
  y: number
  width: number
  height: number
  line: number
}

export interface NovaTextLayoutLine {
  index: number
  start: number
  end: number
  x: number
  y: number
  width: number
  height: number
  text: string
}

export interface NovaTextInputLayoutResult {
  text: string
  width: number
  height: number
  contentX: number
  contentY: number
  contentWidth: number
  contentHeight: number
  scrollX: number
  scrollY: number
  fontSize: number
  lineHeight: number
  charWidth: number
  multiline: boolean
  wrap: boolean
  lines: Array<NovaTextLayoutLine>
  glyphs: Array<NovaTextLayoutGlyph>
}

export interface NovaInputValidationState {
  result: NovaInputValidationResult
  pending: boolean
  dirty: boolean
  touched: boolean
  submitted: boolean
  message?: string
  code?: string
}
