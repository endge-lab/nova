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
  private value: string
  private draft: string
  private selectionStart = 0
  private selectionEnd = 0
  private focused = false
  private composing = false
  private dirty = false
  private readonly multiline: boolean
  private readonly maxLength?: number
  private readonly historyLimit: number
  private history: Array<{ draft: string, selectionStart: number, selectionEnd: number }> = []

  /**
   * Создает экземпляр NovaTextInputController и подготавливает базовое состояние.
   */
  constructor(private readonly options: NovaTextInputControllerOptions = {}) {
    this.value = stringify(options.value ?? options.defaultValue ?? '')
    this.draft = this.value
    this.multiline = options.multiline ?? false
    this.maxLength = options.maxLength
    this.historyLimit = Math.max(0, options.historyLimit ?? 100)
    this.select(this.draft.length, this.draft.length)
  }

  /**
   * Возвращает значение состояния NovaTextInputController.
   */
  getState(): NovaTextInputSnapshot {
    return {
      value: this.value,
      draft: this.draft,
      selectionStart: this.selectionStart,
      selectionEnd: this.selectionEnd,
      focused: this.focused,
      composing: this.composing,
      dirty: this.dirty,
      readonly: this.options.readonly ?? false,
      disabled: this.options.disabled ?? false,
    }
  }

  /**
   * Обновляет значение состояния NovaTextInputController.
   */
  setValue(value: string | number, context: NovaTextInputContext = {}): void {
    const next = this.clampValue(stringify(value))
    this.value = next
    this.draft = next
    this.dirty = false
    this.select(next.length, next.length)
    this.options.onValueChange?.(next, context)
  }

  /**
   * Обновляет значение состояния NovaTextInputController.
   */
  setDraft(value: string | number, context: NovaTextInputContext = {}): void {
    if (!this.canEdit()) {
      return
    }
    this.pushHistory()
    this.draft = this.clampValue(stringify(value))
    this.dirty = this.draft !== this.value
    this.select(Math.min(this.selectionStart, this.draft.length), Math.min(this.selectionEnd, this.draft.length))
    this.options.onValueChange?.(this.draft, context)
  }

  /**
   * Переводит focus в целевое состояние NovaTextInputController.
   */
  focus(): void {
    if (this.options.disabled) {
      return
    }
    this.focused = true
  }

  /**
   * Снимает focus с целевого состояния NovaTextInputController.
   */
  blur(): void {
    this.focused = false
  }

  /**
   * Обновляет состояние выбора NovaTextInputController.
   */
  select(start = 0, end = start): void {
    this.selectionStart = clamp(start, 0, this.draft.length)
    this.selectionEnd = clamp(end, 0, this.draft.length)
  }

  /**
   * Обновляет состояние выбора NovaTextInputController.
   */
  selectAll(): void {
    this.select(0, this.draft.length)
  }

  /**
   * Возвращает значение состояния NovaTextInputController.
   */
  getSelection(): NovaTextSelection {
    return { start: this.selectionStart, end: this.selectionEnd, direction: 'none' }
  }

  /**
   * Возвращает значение состояния NovaTextInputController.
   */
  getSelectedText(): string {
    const [start, end] = this.selectionBounds()
    return this.draft.slice(start, end)
  }

  /**
   * Добавляет сущность в runtime-коллекцию NovaTextInputController.
   */
  insertText(text: string, context: NovaTextInputContext = {}): void {
    if (!this.canEdit() || text.length === 0) {
      return
    }
    const normalized = this.multiline ? text : text.replace(/\r?\n/g, ' ')
    const [start, end] = this.selectionBounds()
    const next = this.clampValue(this.draft.slice(0, start) + normalized + this.draft.slice(end))
    const insertedLength = Math.max(0, next.length - (this.draft.length - (end - start)))
    this.pushHistory()
    this.draft = next
    this.dirty = this.draft !== this.value
    this.select(start + insertedLength, start + insertedLength)
    this.options.onValueChange?.(this.draft, context)
  }

  /**
   * Удаляет сущность из runtime-коллекции NovaTextInputController.
   */
  deleteBackward(context: NovaTextInputContext = {}): void {
    if (!this.canEdit()) {
      return
    }
    const [start, end] = this.selectionBounds()
    if (start !== end) {
      this.replaceRange(start, end, '', context)
      return
    }
    if (start <= 0) {
      return
    }
    const previous = previousGraphemeIndex(this.draft, start)
    this.replaceRange(previous, start, '', context)
  }

  /**
   * Удаляет сущность из runtime-коллекции NovaTextInputController.
   */
  deleteForward(context: NovaTextInputContext = {}): void {
    if (!this.canEdit()) {
      return
    }
    const [start, end] = this.selectionBounds()
    if (start !== end) {
      this.replaceRange(start, end, '', context)
      return
    }
    if (start >= this.draft.length) {
      return
    }
    const next = nextGraphemeIndex(this.draft, start)
    this.replaceRange(start, next, '', context)
  }

  /**
   * Выполняет действие moveCaret в рамках ответственности NovaTextInputController.
   */
  moveCaret(direction: 'left' | 'right' | 'home' | 'end' | 'up' | 'down', options: { shift?: boolean, word?: boolean, layout?: NovaTextInputLayoutResult } = {}): void {
    const anchor = options.shift ? this.selectionStart : this.selectionEnd
    let next = this.selectionEnd
    if (direction === 'left') {
      next = options.word ? previousWordIndex(this.draft, next) : previousGraphemeIndex(this.draft, next)
    }
    if (direction === 'right') {
      next = options.word ? nextWordIndex(this.draft, next) : nextGraphemeIndex(this.draft, next)
    }
    if (direction === 'home') {
      next = lineBoundary(this.draft, next, 'start')
    }
    if (direction === 'end') {
      next = lineBoundary(this.draft, next, 'end')
    }
    if (direction === 'up' || direction === 'down') {
      next = verticalMoveIndex(this.selectionEnd, direction, options.layout)
    }
    this.select(options.shift ? anchor : next, next)
  }

  /**
   * Обрабатывает runtime-событие NovaTextInputController.
   */
  handleKeydown(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'preventDefault'>, context: NovaTextInputContext = {}): boolean {
    if (this.options.disabled) {
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
      if (this.multiline && !event.metaKey && !event.ctrlKey) {
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
    this.value = this.draft
    this.dirty = false
    this.options.onCommit?.(this.value, context)
  }

  /**
   * Выполняет действие cancel в рамках ответственности NovaTextInputController.
   */
  cancel(context: NovaTextInputContext = {}): void {
    this.draft = this.value
    this.dirty = false
    this.select(this.draft.length, this.draft.length)
    this.options.onCancel?.(context)
  }

  /**
   * Запускает runtime-процесс NovaTextInputController.
   */
  startComposition(): void {
    this.composing = true
  }

  /**
   * Обновляет runtime-состояние NovaTextInputController.
   */
  updateComposition(text: string, context: NovaTextInputContext = {}): void {
    if (!this.composing) {
      this.startComposition()
    }
    this.insertText(text, context)
  }

  /**
   * Выполняет действие endComposition в рамках ответственности NovaTextInputController.
   */
  endComposition(): void {
    this.composing = false
  }

  /**
   * Выполняет действие undo в рамках ответственности NovaTextInputController.
   */
  undo(): void {
    const previous = this.history.pop()
    if (!previous) {
      return
    }
    this.draft = previous.draft
    this.select(previous.selectionStart, previous.selectionEnd)
    this.dirty = this.draft !== this.value
  }

  /**
   * Выполняет внутренний шаг replaceRange для NovaTextInputController.
   */
  private replaceRange(start: number, end: number, text: string, context: NovaTextInputContext): void {
    this.pushHistory()
    this.draft = this.clampValue(this.draft.slice(0, start) + text + this.draft.slice(end))
    const caret = start + text.length
    this.select(caret, caret)
    this.dirty = this.draft !== this.value
    this.options.onValueChange?.(this.draft, context)
  }

  /**
   * Обновляет состояние выбора NovaTextInputController.
   */
  private selectionBounds(): [number, number] {
    return [Math.min(this.selectionStart, this.selectionEnd), Math.max(this.selectionStart, this.selectionEnd)]
  }

  /**
   * Выполняет внутренний шаг canEdit для NovaTextInputController.
   */
  private canEdit(): boolean {
    return !(this.options.disabled || this.options.readonly)
  }

  /**
   * Ограничивает значение допустимым диапазоном NovaTextInputController.
   */
  private clampValue(value: string): string {
    if (this.maxLength === undefined) {
      return value
    }
    return value.slice(0, Math.max(0, this.maxLength))
  }

  /**
   * Выполняет внутренний шаг pushHistory для NovaTextInputController.
   */
  private pushHistory(): void {
    if (this.historyLimit <= 0) {
      return
    }
    this.history.push({ draft: this.draft, selectionStart: this.selectionStart, selectionEnd: this.selectionEnd })
    if (this.history.length > this.historyLimit) {
      this.history.shift()
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
