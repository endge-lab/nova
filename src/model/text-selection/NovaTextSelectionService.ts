import { NovaClipboardService, type NovaClipboardResult } from '@/model/input/NovaClipboardService'
import type {
  NovaTextSelectionAnchor,
  NovaTextSelectionHit,
  NovaTextSelectionOptions,
  NovaTextSelectionRange,
  NovaTextSelectionResolvedTarget,
  NovaTextSelectionState,
  NovaTextSelectionTarget,
} from '@/model/text-selection/nova-text-selection.types'

const DEFAULT_SELECTION_COLOR = 'rgba(37, 99, 235, 0.24)'
const DEFAULT_BUCKET_SIZE = 128

interface BucketEntry<TContext> {
  target: NovaTextSelectionResolvedTarget<TContext>
}

export class NovaTextSelectionService<TContext = unknown> {
  private readonly clipboard = new NovaClipboardService()
  private readonly targets = new Map<string, NovaTextSelectionResolvedTarget<TContext>>()
  private readonly buckets = new Map<string, Array<BucketEntry<TContext>>>()
  private readonly orderedTargets: Array<NovaTextSelectionResolvedTarget<TContext>> = []
  private anchor: NovaTextSelectionAnchor | null = null
  private focus: NovaTextSelectionAnchor | null = null
  private dragging = false
  private orderCursor = 0

  constructor(private options: Required<NovaTextSelectionOptions> = resolveNovaTextSelectionOptions()) {}

  configure(options: NovaTextSelectionOptions | false | undefined): void {
    this.options = resolveNovaTextSelectionOptions(options)
    if (!this.options.enabled) this.clear()
  }

  beginFrame(): void {
    this.targets.clear()
    this.buckets.clear()
    this.orderedTargets.length = 0
    this.orderCursor = 0
  }

  register(target: NovaTextSelectionTarget<TContext>): void {
    if (!this.options.enabled) return
    if (!target.text) return
    const selectable = target.selectable ?? this.options.mode === 'all-text'
    if (!selectable) return

    const resolved: NovaTextSelectionResolvedTarget<TContext> = {
      ...target,
      selectable,
      copyable: target.copyable ?? this.options.copy,
      zIndex: target.zIndex ?? 0,
      order: target.order ?? this.orderCursor,
    }
    this.orderCursor += 1
    this.targets.set(resolved.id, resolved)
    this.orderedTargets.push(resolved)
    this.addToBuckets(resolved)
  }

  hitTest(x: number, y: number): NovaTextSelectionHit<TContext> | null {
    if (!this.options.enabled) return null
    const candidates = this.buckets.get(this.bucketKey(x, y)) ?? []
    const target = candidates
      .map(item => item.target)
      .filter(item => containsPoint(item, x, y))
      .sort((a, b) => b.zIndex - a.zIndex || b.order - a.order)[0]
    if (!target) return null
    return {
      target,
      offset: resolveTextOffset(target, x),
    }
  }

  start(x: number, y: number): boolean {
    const hit = this.hitTest(x, y)
    if (!hit) {
      this.clear()
      return false
    }
    this.anchor = { targetId: hit.target.id, offset: hit.offset }
    this.focus = { ...this.anchor }
    this.dragging = true
    return true
  }

  update(x: number, y: number): boolean {
    if (!this.anchor || !this.dragging || !this.options.drag) return false
    const hit = this.hitTest(x, y)
    if (!hit) return false
    this.focus = { targetId: hit.target.id, offset: hit.offset }
    return true
  }

  end(): void {
    this.dragging = false
  }

  clear(): void {
    this.anchor = null
    this.focus = null
    this.dragging = false
  }

  hasSelection(): boolean {
    return this.getRanges().length > 0
  }

  getSelectionColor(): string {
    return this.options.selectionColor
  }

  getRanges(): Array<NovaTextSelectionRange<TContext>> {
    if (!this.anchor || !this.focus) return []
    const anchorTarget = this.targets.get(this.anchor.targetId)
    const focusTarget = this.targets.get(this.focus.targetId)
    if (!anchorTarget || !focusTarget) return []

    if (anchorTarget.id === focusTarget.id) {
      const start = Math.min(this.anchor.offset, this.focus.offset)
      const end = Math.max(this.anchor.offset, this.focus.offset)
      if (start === end) return []
      return [{ target: anchorTarget, range: { start, end } }]
    }

    const sorted = [...this.orderedTargets].sort((a, b) => a.order - b.order)
    const anchorIndex = sorted.findIndex(target => target.id === anchorTarget.id)
    const focusIndex = sorted.findIndex(target => target.id === focusTarget.id)
    if (anchorIndex < 0 || focusIndex < 0) return []

    const forward = anchorIndex < focusIndex
    const startIndex = Math.min(anchorIndex, focusIndex)
    const endIndex = Math.max(anchorIndex, focusIndex)
    const ranges: Array<NovaTextSelectionRange<TContext>> = []

    for (let index = startIndex; index <= endIndex; index += 1) {
      const target = sorted[index]
      if (!target.copyable) continue
      if (target.id === anchorTarget.id) {
        ranges.push({
          target,
          range: forward
            ? { start: this.anchor.offset, end: target.text.length }
            : { start: 0, end: this.anchor.offset },
        })
      } else if (target.id === focusTarget.id) {
        ranges.push({
          target,
          range: forward
            ? { start: 0, end: this.focus.offset }
            : { start: this.focus.offset, end: target.text.length },
        })
      } else {
        ranges.push({ target, range: { start: 0, end: target.text.length } })
      }
    }

    return ranges.filter(item => item.range.end > item.range.start)
  }

  getSelectedText(formatter?: (ranges: Array<NovaTextSelectionRange<TContext>>) => string): string {
    const ranges = this.getRanges()
    if (formatter) return formatter(ranges)
    return ranges
      .map(item => (item.target.copyText ?? item.target.text).slice(item.range.start, item.range.end))
      .join('\n')
  }

  async copy(formatter?: (ranges: Array<NovaTextSelectionRange<TContext>>) => string): Promise<NovaClipboardResult> {
    if (!this.options.copy) return { ok: false, error: new Error('Text selection copy is disabled') }
    const text = this.getSelectedText(formatter)
    if (!text) return { ok: false, error: new Error('No text selected') }
    return this.clipboard.writeText(text)
  }

  getState(formatter?: (ranges: Array<NovaTextSelectionRange<TContext>>) => string): NovaTextSelectionState<TContext> {
    const ranges = this.getRanges()
    return {
      active: ranges.length > 0,
      dragging: this.dragging,
      anchor: this.anchor ? { ...this.anchor } : null,
      focus: this.focus ? { ...this.focus } : null,
      ranges,
      text: formatter ? formatter(ranges) : this.getSelectedText(),
    }
  }

  private addToBuckets(target: NovaTextSelectionResolvedTarget<TContext>): void {
    const minX = Math.floor(target.rect.x / DEFAULT_BUCKET_SIZE)
    const maxX = Math.floor((target.rect.x + target.rect.width) / DEFAULT_BUCKET_SIZE)
    const minY = Math.floor(target.rect.y / DEFAULT_BUCKET_SIZE)
    const maxY = Math.floor((target.rect.y + target.rect.height) / DEFAULT_BUCKET_SIZE)
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${x}:${y}`
        const entries = this.buckets.get(key) ?? []
        entries.push({ target })
        this.buckets.set(key, entries)
      }
    }
  }

  private bucketKey(x: number, y: number): string {
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
  if (target.text.length === 0) return 0
  const ratio = Math.max(0, Math.min(1, (x - target.rect.x) / Math.max(1, target.rect.width)))
  return Math.max(0, Math.min(target.text.length, Math.round(target.text.length * ratio)))
}
