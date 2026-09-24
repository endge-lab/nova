import type {
  NovaTextInputContext,
  NovaTextInputControllerOptions,
  NovaTextInputLayoutResult,
  NovaTextInputSnapshot,
  NovaTextSelection,
} from '@/model/input/nova-input.types'
import { splitGraphemes } from '@/model/input/NovaTextLayoutEngine'

/**
 * Координирует поведение контроллера NovaTextInputController.
 */
export class NovaTextInputController {
  private _value: string
  private _draft: string
  private _selectionStart = 0
  private _selectionEnd = 0
  private _focused = false
  private _composing = false
  private _dirty = false
  private readonly _multiline: boolean
  private readonly _maxLength?: number
  private readonly _historyLimit: number
  private _history: Array<{ draft: string, selectionStart: number, selectionEnd: number }> = []

  /**
   * Создает экземпляр NovaTextInputController и подготавливает базовое состояние.
   */
  constructor(private readonly _options: NovaTextInputControllerOptions = {}) {
    this._value = stringify(_options.value ?? _options.defaultValue ?? '')
    this._draft = this._value
    this._multiline = _options.multiline ?? false
    this._maxLength = _options.maxLength
    this._historyLimit = Math.max(0, _options.historyLimit ?? 100)
    this.select(this._draft.length, this._draft.length)
  }

  /**
   * Возвращает значение состояния NovaTextInputController.
   */
  getState(): NovaTextInputSnapshot {
    return {
      value: this._value,
      draft: this._draft,
      selectionStart: this._selectionStart,
      selectionEnd: this._selectionEnd,
      focused: this._focused,
      composing: this._composing,
      dirty: this._dirty,
      readonly: this._options.readonly ?? false,
      disabled: this._options.disabled ?? false,
    }
  }

  /**
   * Обновляет значение состояния NovaTextInputController.
   */
  setValue(value: string | number, context: NovaTextInputContext = {}): void {
    const next = this._clampValue(stringify(value))
    this._value = next
    this._draft = next
    this._dirty = false
    this.select(next.length, next.length)
    this._options.onValueChange?.(next, context)
  }

  /**
   * Обновляет значение состояния NovaTextInputController.
   */
  setDraft(value: string | number, context: NovaTextInputContext = {}): void {
    if (!this._canEdit()) {
      return
    }
    this._pushHistory()
    this._draft = this._clampValue(stringify(value))
    this._dirty = this._draft !== this._value
    this.select(Math.min(this._selectionStart, this._draft.length), Math.min(this._selectionEnd, this._draft.length))
    this._options.onValueChange?.(this._draft, context)
  }

  /**
   * Переводит focus в целевое состояние NovaTextInputController.
   */
  focus(): void {
    if (this._options.disabled) {
      return
    }
    this._focused = true
  }

  /**
   * Снимает focus с целевого состояния NovaTextInputController.
   */
  blur(): void {
    this._focused = false
  }

  /**
   * Обновляет состояние выбора NovaTextInputController.
   */
  select(start = 0, end = start): void {
    this._selectionStart = clamp(start, 0, this._draft.length)
    this._selectionEnd = clamp(end, 0, this._draft.length)
  }

  /**
   * Обновляет состояние выбора NovaTextInputController.
   */
  selectAll(): void {
    this.select(0, this._draft.length)
  }

  /**
   * Возвращает значение состояния NovaTextInputController.
   */
  getSelection(): NovaTextSelection {
    return { start: this._selectionStart, end: this._selectionEnd, direction: 'none' }
  }

  /**
   * Возвращает значение состояния NovaTextInputController.
   */
  getSelectedText(): string {
    const [start, end] = this._selectionBounds()
    return this._draft.slice(start, end)
  }

  /**
   * Добавляет сущность в runtime-коллекцию NovaTextInputController.
   */
  insertText(text: string, context: NovaTextInputContext = {}): void {
    if (!this._canEdit() || text.length === 0) {
      return
    }
    const normalized = this._multiline ? text : text.replace(/\r?\n/g, ' ')
    const [start, end] = this._selectionBounds()
    const next = this._clampValue(this._draft.slice(0, start) + normalized + this._draft.slice(end))
    const insertedLength = Math.max(0, next.length - (this._draft.length - (end - start)))
    this._pushHistory()
    this._draft = next
    this._dirty = this._draft !== this._value
    this.select(start + insertedLength, start + insertedLength)
    this._options.onValueChange?.(this._draft, context)
  }

  /**
   * Удаляет сущность из runtime-коллекции NovaTextInputController.
   */
  deleteBackward(context: NovaTextInputContext = {}): void {
    if (!this._canEdit()) {
      return
    }
    const [start, end] = this._selectionBounds()
    if (start !== end) {
      this._replaceRange(start, end, '', context)
      return
    }
    if (start <= 0) {
      return
    }
    const previous = previousGraphemeIndex(this._draft, start)
    this._replaceRange(previous, start, '', context)
  }

  /**
   * Удаляет сущность из runtime-коллекции NovaTextInputController.
   */
  deleteForward(context: NovaTextInputContext = {}): void {
    if (!this._canEdit()) {
      return
    }
    const [start, end] = this._selectionBounds()
    if (start !== end) {
      this._replaceRange(start, end, '', context)
      return
    }
    if (start >= this._draft.length) {
      return
    }
    const next = nextGraphemeIndex(this._draft, start)
    this._replaceRange(start, next, '', context)
  }

  /**
   * Выполняет действие moveCaret в рамках ответственности NovaTextInputController.
   */
  moveCaret(direction: 'left' | 'right' | 'home' | 'end' | 'up' | 'down', options: { shift?: boolean, word?: boolean, layout?: NovaTextInputLayoutResult } = {}): void {
    const anchor = options.shift ? this._selectionStart : this._selectionEnd
    let next = this._selectionEnd
    if (direction === 'left') {
      next = options.word ? previousWordIndex(this._draft, next) : previousGraphemeIndex(this._draft, next)
    }
    if (direction === 'right') {
      next = options.word ? nextWordIndex(this._draft, next) : nextGraphemeIndex(this._draft, next)
    }
    if (direction === 'home') {
      next = lineBoundary(this._draft, next, 'start')
    }
    if (direction === 'end') {
      next = lineBoundary(this._draft, next, 'end')
    }
    if (direction === 'up' || direction === 'down') {
      next = verticalMoveIndex(this._selectionEnd, direction, options.layout)
    }
    this.select(options.shift ? anchor : next, next)
  }

  /**
   * Обрабатывает runtime-событие NovaTextInputController.
   */
  handleKeydown(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'preventDefault'>, context: NovaTextInputContext = {}): boolean {
    if (this._options.disabled) {
      return false
    }
    const command = event.metaKey || event.ctrlKey
    if (command && event.key.toLowerCase() === 'a') {
      this.selectAll()
      event.preventDefault?.()
      return true
    }
    if (event.key === 'Backspace') {
      this.deleteBackward(context)
      event.preventDefault?.()
      return true
    }
    if (event.key === 'Delete') {
      this.deleteForward(context)
      event.preventDefault?.()
      return true
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      this.moveCaret(event.key === 'ArrowLeft' ? 'left' : 'right', { shift: event.shiftKey, word: event.altKey || event.ctrlKey })
      event.preventDefault?.()
      return true
    }
    if (event.key === 'Home' || event.key === 'End') {
      this.moveCaret(event.key === 'Home' ? 'home' : 'end', { shift: event.shiftKey })
      event.preventDefault?.()
      return true
    }
    if (event.key === 'Enter') {
      if (this._multiline && !event.metaKey && !event.ctrlKey) {
        this.insertText('\n', context)
      }
      else {
        this.commit(context)
      }
      event.preventDefault?.()
      return true
    }
    if (event.key === 'Escape') {
      this.cancel(context)
      event.preventDefault?.()
      return true
    }
    if (!command && event.key.length === 1 && !event.altKey) {
      this.insertText(event.key, context)
      event.preventDefault?.()
      return true
    }
    return false
  }

  /**
   * Фиксирует подготовленные изменения NovaTextInputController.
   */
  commit(context: NovaTextInputContext = {}): void {
    this._value = this._draft
    this._dirty = false
    this._options.onCommit?.(this._value, context)
  }

  /**
   * Выполняет действие cancel в рамках ответственности NovaTextInputController.
   */
  cancel(context: NovaTextInputContext = {}): void {
    this._draft = this._value
    this._dirty = false
    this.select(this._draft.length, this._draft.length)
    this._options.onCancel?.(context)
  }

  /**
   * Запускает runtime-процесс NovaTextInputController.
   */
  startComposition(): void {
    this._composing = true
  }

  /**
   * Обновляет runtime-состояние NovaTextInputController.
   */
  updateComposition(text: string, context: NovaTextInputContext = {}): void {
    if (!this._composing) {
      this.startComposition()
    }
    this.insertText(text, context)
  }

  /**
   * Выполняет действие endComposition в рамках ответственности NovaTextInputController.
   */
  endComposition(): void {
    this._composing = false
  }

  /**
   * Выполняет действие undo в рамках ответственности NovaTextInputController.
   */
  undo(): void {
    const previous = this._history.pop()
    if (!previous) {
      return
    }
    this._draft = previous.draft
    this.select(previous.selectionStart, previous.selectionEnd)
    this._dirty = this._draft !== this._value
  }

  /**
   * Выполняет внутренний шаг replaceRange для NovaTextInputController.
   */
  private _replaceRange(start: number, end: number, text: string, context: NovaTextInputContext): void {
    this._pushHistory()
    this._draft = this._clampValue(this._draft.slice(0, start) + text + this._draft.slice(end))
    const caret = start + text.length
    this.select(caret, caret)
    this._dirty = this._draft !== this._value
    this._options.onValueChange?.(this._draft, context)
  }

  /**
   * Обновляет состояние выбора NovaTextInputController.
   */
  private _selectionBounds(): [number, number] {
    return [Math.min(this._selectionStart, this._selectionEnd), Math.max(this._selectionStart, this._selectionEnd)]
  }

  /**
   * Выполняет внутренний шаг canEdit для NovaTextInputController.
   */
  private _canEdit(): boolean {
    return !(this._options.disabled || this._options.readonly)
  }

  /**
   * Ограничивает значение допустимым диапазоном NovaTextInputController.
   */
  private _clampValue(value: string): string {
    if (this._maxLength === undefined) {
      return value
    }
    return value.slice(0, Math.max(0, this._maxLength))
  }

  /**
   * Выполняет внутренний шаг pushHistory для NovaTextInputController.
   */
  private _pushHistory(): void {
    if (this._historyLimit <= 0) {
      return
    }
    this._history.push({ draft: this._draft, selectionStart: this._selectionStart, selectionEnd: this._selectionEnd })
    if (this._history.length > this._historyLimit) {
      this._history.shift()
    }
  }
}

function stringify(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function previousGraphemeIndex(text: string, index: number): number {
  const segments = splitGraphemes(text).filter(segment => segment.index < index)
  return segments.length ? segments[segments.length - 1].index : 0
}

function nextGraphemeIndex(text: string, index: number): number {
  const segment = splitGraphemes(text).find(candidate => candidate.index >= index)
  return segment ? segment.end : text.length
}

function previousWordIndex(text: string, index: number): number {
  const before = text.slice(0, index).replace(/\s+$/g, '')
  const match = before.match(/\S+$/)
  return match?.index ?? 0
}

function nextWordIndex(text: string, index: number): number {
  const after = text.slice(index)
  const match = after.match(/\s+\S|\s*$/)
  if (!match) {
    return text.length
  }
  return Math.min(text.length, index + (match.index ?? 0) + match[0].length)
}

function lineBoundary(text: string, index: number, edge: 'start' | 'end'): number {
  if (edge === 'start') {
    return text.lastIndexOf('\n', Math.max(0, index - 1)) + 1
  }
  const next = text.indexOf('\n', index)
  return next === -1 ? text.length : next
}

function verticalMoveIndex(index: number, direction: 'up' | 'down', layout?: NovaTextInputLayoutResult): number {
  if (!layout) {
    return index
  }
  const caretGlyph = layout.glyphs.find(glyph => index >= glyph.index && index <= glyph.end)
  const lineIndex = caretGlyph?.line ?? layout.lines.findIndex(line => index >= line.start && index <= line.end)
  const targetLine = layout.lines[(lineIndex < 0 ? 0 : lineIndex) + (direction === 'up' ? -1 : 1)]
  if (!targetLine) {
    return index
  }
  const currentX = caretGlyph ? caretGlyph.x : layout.contentX
  const candidates = layout.glyphs.filter(glyph => glyph.line === targetLine.index)
  if (candidates.length === 0) {
    return targetLine.start
  }
  return candidates.reduce((best, glyph) => Math.abs(glyph.x - currentX) < Math.abs(best.x - currentX) ? glyph : best, candidates[0]).index
}
