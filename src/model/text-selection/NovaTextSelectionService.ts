import type { NovaClipboardResult } from '@/model/input/NovaClipboardService'
import type {
  NovaTextSelectionAnchor,
  NovaTextSelectionHit,
  NovaTextSelectionOptions,
  NovaTextSelectionRange,
  NovaTextSelectionResolvedTarget,
  NovaTextSelectionState,
  NovaTextSelectionTarget,
} from '@/model/text-selection/nova-text-selection.types'
import { NovaClipboardService } from '@/model/input/NovaClipboardService'

const DEFAULT_SELECTION_COLOR = 'rgba(37, 99, 235, 0.24)'
const DEFAULT_BUCKET_SIZE = 128

interface BucketEntry<TContext> {
  target: NovaTextSelectionResolvedTarget<TContext>
}

/**
 * Инкапсулирует сервисную логику NovaTextSelectionService.
 */
export class NovaTextSelectionService<TContext = unknown> {
  private readonly _clipboard = new NovaClipboardService()
  private readonly _targets = new Map<string, NovaTextSelectionResolvedTarget<TContext>>()
  private readonly _buckets = new Map<string, Array<BucketEntry<TContext>>>()
  private readonly _orderedTargets: Array<NovaTextSelectionResolvedTarget<TContext>> = []
  private _anchor: NovaTextSelectionAnchor | null = null
  private _focus: NovaTextSelectionAnchor | null = null
  private _dragging = false
  private _orderCursor = 0

  /**
   * Создает экземпляр NovaTextSelectionService и подготавливает базовое состояние.
   */
  constructor(private _options: Required<NovaTextSelectionOptions> = resolveNovaTextSelectionOptions()) {}

  /**
   * Выполняет действие configure в рамках ответственности NovaTextSelectionService.
   */
  configure(options: NovaTextSelectionOptions | false | undefined): void {
    this._options = resolveNovaTextSelectionOptions(options)
    if (!this._options.enabled) {
      this.clear()
    }
  }

  /**
   * Выполняет действие beginFrame в рамках ответственности NovaTextSelectionService.
   */
  beginFrame(): void {
    this._targets.clear()
    this._buckets.clear()
    this._orderedTargets.length = 0
    this._orderCursor = 0
  }

  /**
   * Регистрирует сущность в runtime-слое NovaTextSelectionService.
   */
  register(target: NovaTextSelectionTarget<TContext>): void {
    if (!this._options.enabled) {
      return
    }
    if (!target.text) {
      return
    }
    const selectable = target.selectable ?? this._options.mode === 'all-text'
    if (!selectable) {
      return
    }

    const resolved: NovaTextSelectionResolvedTarget<TContext> = {
      ...target,
      selectable,
      copyable: target.copyable ?? this._options.copy,
      zIndex: target.zIndex ?? 0,
      order: target.order ?? this._orderCursor,
    }
    this._orderCursor += 1
    this._targets.set(resolved.id, resolved)
    this._orderedTargets.push(resolved)
    this._addToBuckets(resolved)
  }

  /**
   * Выполняет hit-test для runtime-геометрии NovaTextSelectionService.
   */
  hitTest(x: number, y: number): NovaTextSelectionHit<TContext> | null {
    if (!this._options.enabled) {
      return null
    }
    const candidates = this._buckets.get(this._bucketKey(x, y)) ?? []
    const target = candidates
      .map(item => item.target)
      .filter(item => containsPoint(item, x, y))
      .sort((a, b) => b.zIndex - a.zIndex || b.order - a.order)[0]
    if (!target) {
      return null
    }
    return {
      target,
      offset: resolveTextOffset(target, x),
    }
  }

  /**
   * Запускает runtime-процесс NovaTextSelectionService.
   */
  start(x: number, y: number): boolean {
    const hit = this.hitTest(x, y)
    if (!hit) {
      this.clear()
      return false
    }
    this._anchor = { targetId: hit.target.id, offset: hit.offset }
    this._focus = { ...this._anchor }
    this._dragging = true
    return true
  }

  /**
   * Обновляет runtime-состояние NovaTextSelectionService.
   */
  update(x: number, y: number): boolean {
    if (!this._anchor || !this._dragging || !this._options.drag) {
      return false
    }
    const hit = this.hitTest(x, y)
    if (!hit) {
      return false
    }
    this._focus = { targetId: hit.target.id, offset: hit.offset }
    return true
  }

  /**
   * Выполняет действие end в рамках ответственности NovaTextSelectionService.
   */
  end(): void {
    this._dragging = false
  }

  /**
   * Очищает накопленное состояние NovaTextSelectionService.
   */
  clear(): void {
    this._anchor = null
    this._focus = null
    this._dragging = false
  }

  /**
   * Выполняет действие hasSelection в рамках ответственности NovaTextSelectionService.
   */
  hasSelection(): boolean {
    return this.getRanges().length > 0
  }

  /**
   * Возвращает значение состояния NovaTextSelectionService.
   */
  getSelectionColor(): string {
    return this._options.selectionColor
  }

  /**
   * Возвращает значение состояния NovaTextSelectionService.
   */
  getRanges(): Array<NovaTextSelectionRange<TContext>> {
    if (!this._anchor || !this._focus) {
      return []
    }
    const anchorTarget = this._targets.get(this._anchor.targetId)
    const focusTarget = this._targets.get(this._focus.targetId)
    if (!anchorTarget || !focusTarget) {
      return []
    }

    if (anchorTarget.id === focusTarget.id) {
      const start = Math.min(this._anchor.offset, this._focus.offset)
      const end = Math.max(this._anchor.offset, this._focus.offset)
      if (start === end) {
        return []
      }
      return [{ target: anchorTarget, range: { start, end } }]
    }

    const sorted = [...this._orderedTargets].sort((a, b) => a.order - b.order)
    const anchorIndex = sorted.findIndex(target => target.id === anchorTarget.id)
    const focusIndex = sorted.findIndex(target => target.id === focusTarget.id)
    if (anchorIndex < 0 || focusIndex < 0) {
      return []
    }

    const forward = anchorIndex < focusIndex
    const startIndex = Math.min(anchorIndex, focusIndex)
    const endIndex = Math.max(anchorIndex, focusIndex)
    const ranges: Array<NovaTextSelectionRange<TContext>> = []

    for (let index = startIndex; index <= endIndex; index += 1) {
      const target = sorted[index]
      if (!target.copyable) {
        continue
      }
      if (target.id === anchorTarget.id) {
        ranges.push({
          target,
          range: forward
            ? { start: this._anchor.offset, end: target.text.length }
            : { start: 0, end: this._anchor.offset },
        })
      }
      else if (target.id === focusTarget.id) {
        ranges.push({
          target,
          range: forward
            ? { start: 0, end: this._focus.offset }
            : { start: this._focus.offset, end: target.text.length },
        })
      }
      else {
        ranges.push({ target, range: { start: 0, end: target.text.length } })
      }
    }

    return ranges.filter(item => item.range.end > item.range.start)
  }

  /**
   * Возвращает значение состояния NovaTextSelectionService.
   */
  getSelectedText(formatter?: (ranges: Array<NovaTextSelectionRange<TContext>>) => string): string {
    const ranges = this.getRanges()
    if (formatter) {
      return formatter(ranges)
    }
    return ranges
      .map(item => (item.target.copyText ?? item.target.text).slice(item.range.start, item.range.end))
      .join('\n')
  }

  /**
   * Выполняет действие copy в рамках ответственности NovaTextSelectionService.
   */
  async copy(formatter?: (ranges: Array<NovaTextSelectionRange<TContext>>) => string): Promise<NovaClipboardResult> {
    if (!this._options.copy) {
      return { ok: false, error: new Error('Text selection copy is disabled') }
    }
    const text = this.getSelectedText(formatter)
    if (!text) {
      return { ok: false, error: new Error('No text selected') }
    }
    return this._clipboard.writeText(text)
  }

  /**
   * Возвращает значение состояния NovaTextSelectionService.
   */
  getState(formatter?: (ranges: Array<NovaTextSelectionRange<TContext>>) => string): NovaTextSelectionState<TContext> {
    const ranges = this.getRanges()
    return {
      active: ranges.length > 0,
      dragging: this._dragging,
      anchor: this._anchor ? { ...this._anchor } : null,
      focus: this._focus ? { ...this._focus } : null,
      ranges,
      text: formatter ? formatter(ranges) : this.getSelectedText(),
    }
  }

  /**
   * Выполняет внутренний шаг addToBuckets для NovaTextSelectionService.
   */
  private _addToBuckets(target: NovaTextSelectionResolvedTarget<TContext>): void {
    const minX = Math.floor(target.rect.x / DEFAULT_BUCKET_SIZE)
    const maxX = Math.floor((target.rect.x + target.rect.width) / DEFAULT_BUCKET_SIZE)
    const minY = Math.floor(target.rect.y / DEFAULT_BUCKET_SIZE)
    const maxY = Math.floor((target.rect.y + target.rect.height) / DEFAULT_BUCKET_SIZE)
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${x}:${y}`
        const entries = this._buckets.get(key) ?? []
        entries.push({ target })
        this._buckets.set(key, entries)
      }
    }
  }

  /**
   * Выполняет внутренний шаг bucketKey для NovaTextSelectionService.
   */
  private _bucketKey(x: number, y: number): string {
    return `${Math.floor(x / DEFAULT_BUCKET_SIZE)}:${Math.floor(y / DEFAULT_BUCKET_SIZE)}`
  }
}

export function resolveNovaTextSelectionOptions(options?: NovaTextSelectionOptions | false): Required<NovaTextSelectionOptions> {
  if (options === false) {
    return {
      enabled: false,
      mode: 'explicit',
      copy: false,
      drag: false,
      doubleClick: 'word',
      tripleClick: 'line',
      granularity: 'text',
      clipboard: 'plain',
      selectionColor: DEFAULT_SELECTION_COLOR,
    }
  }
  return {
    enabled: options?.enabled ?? false,
    mode: options?.mode ?? 'explicit',
    copy: options?.copy ?? true,
    drag: options?.drag ?? true,
    doubleClick: options?.doubleClick ?? 'word',
    tripleClick: options?.tripleClick ?? 'line',
    granularity: options?.granularity ?? 'text',
    clipboard: options?.clipboard ?? 'plain',
    selectionColor: options?.selectionColor ?? DEFAULT_SELECTION_COLOR,
  }
}

function containsPoint(target: NovaTextSelectionResolvedTarget<unknown>, x: number, y: number): boolean {
  return x >= target.rect.x
    && x <= target.rect.x + target.rect.width
    && y >= target.rect.y
    && y <= target.rect.y + target.rect.height
}

function resolveTextOffset(target: NovaTextSelectionResolvedTarget<unknown>, x: number): number {
  if (target.text.length === 0) {
    return 0
  }
  const ratio = Math.max(0, Math.min(1, (x - target.rect.x) / Math.max(1, target.rect.width)))
  return Math.max(0, Math.min(target.text.length, Math.round(target.text.length * ratio)))
}
