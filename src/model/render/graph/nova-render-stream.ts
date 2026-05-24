import type {
  NovaBatchPlan,
  NovaRenderBatch,
  NovaRenderGroupId,
  NovaRenderSemanticLayer,
  NovaRenderStream,
  NovaRenderStreamId,
  NovaRenderStreamKind,
  NovaRenderStreamSlot,
} from '@/domain/types/rendering/index'
import type { NovaBounds, NovaSemanticScopeKind } from '@/domain/types/renderer.types'

/**
 * Описывает контракт CreateNovaTypedRenderStreamOptions.
 */
export interface CreateNovaTypedRenderStreamOptions {
  id: NovaRenderStreamId
  groupId: NovaRenderGroupId
  kind: NovaRenderStreamKind
  strideFloats?: number
  initialCapacity?: number
}

/**
 * Описывает контракт NovaRenderStreamAllocation.
 */
export interface NovaRenderStreamAllocation {
  slotIndex: number
  offset: number
  count: number
}

/**
 * Описывает контракт NovaRenderStreamDirtyRange.
 */
export interface NovaRenderStreamDirtyRange {
  startSlot: number
  endSlot: number
}

/**
 * Хранит typed render stream, slots и dirty ranges для одного primitive kind.
 */
export class NovaTypedRenderStream implements NovaRenderStream {
  readonly id: NovaRenderStreamId
  readonly groupId: NovaRenderGroupId
  readonly kind: NovaRenderStreamKind
  readonly strideFloats: number
  readonly slots: Array<NovaRenderStreamSlot> = []

  private readonly _slotsByItemId = new Map<string, NovaRenderStreamSlot>()
  private readonly _freeSlots: Array<number> = []
  private readonly _dirtyRanges: Array<NovaRenderStreamDirtyRange> = []
  private _data: Float32Array
  private _slotCount = 0
  private _version = 0

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(options: CreateNovaTypedRenderStreamOptions) {
    this.id = options.id
    this.groupId = options.groupId
    this.kind = options.kind
    this.strideFloats = options.strideFloats ?? resolveNovaRenderStreamStride(options.kind)
    this._data = new Float32Array(Math.max(0, options.initialCapacity ?? 0) * this.strideFloats)
  }

  /**
   * Возвращает slot capacity.
   */
  get slotCapacity(): number {
    return this._data.length / this.strideFloats
  }

  /**
   * Возвращает slot count.
   */
  get slotCount(): number {
    return this._slotCount
  }

  /**
   * Возвращает version.
   */
  get version(): number {
    return this._version
  }

  /**
   * Возвращает data.
   */
  get data(): Float32Array {
    return this._data
  }

  /**
   * Возвращает slots by item id.
   */
  get slotsByItemId(): ReadonlyMap<string, NovaRenderStreamSlot> {
    return this._slotsByItemId
  }

  /**
   * Выполняет внутреннюю операцию allocate slot.
   */
  allocateSlot(options: {
    itemId: string
    count?: number
    order: number
    batchKey: string
    bounds?: NovaBounds
  }): NovaRenderStreamAllocation {
    const existing = this._slotsByItemId.get(options.itemId)
    if (existing) {
      existing.order = options.order
      existing.batchKey = options.batchKey
      existing.bounds = options.bounds
      this.markSlotDirty(existing.offset)
      return {
        slotIndex: existing.offset,
        offset: existing.offset,
        count: existing.count,
      }
    }

    const slotIndex = this._freeSlots.pop() ?? this._slotCount++
    this.ensureSlotCapacity(slotIndex + 1)
    const slot: NovaRenderStreamSlot = {
      itemId: options.itemId,
      offset: slotIndex,
      count: options.count ?? 1,
      order: options.order,
      batchKey: options.batchKey,
      bounds: options.bounds,
    }

    this.slots[slotIndex] = slot
    this._slotsByItemId.set(options.itemId, slot)
    this.markSlotDirty(slotIndex)

    return {
      slotIndex,
      offset: slotIndex,
      count: slot.count,
    }
  }

  /**
   * Записывает slot.
   */
  writeSlot(itemId: string, values: ReadonlyArray<number>): boolean {
    const slot = this._slotsByItemId.get(itemId)
    if (!slot || values.length > this.strideFloats) return false

    const start = slot.offset * this.strideFloats
    this._data.set(values, start)
    this.markSlotDirty(slot.offset)
    return true
  }

  /**
   * Удаляет slot.
   */
  removeSlot(itemId: string): boolean {
    const slot = this._slotsByItemId.get(itemId)
    if (!slot) return false

    this._slotsByItemId.delete(itemId)
    delete this.slots[slot.offset]
    this._freeSlots.push(slot.offset)
    this.markSlotDirty(slot.offset)
    return true
  }

  /**
   * Помечает slot dirty.
   */
  markSlotDirty(slotIndex: number): void {
    this._dirtyRanges.push({ startSlot: slotIndex, endSlot: slotIndex + 1 })
    this._version += 1
  }

  /**
   * Выполняет внутреннюю операцию consume dirty ranges.
   */
  consumeDirtyRanges(): Array<NovaRenderStreamDirtyRange> {
    const merged = mergeSlotDirtyRanges(this._dirtyRanges)
    this._dirtyRanges.length = 0
    return merged
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this.slots.length = 0
    this._slotsByItemId.clear()
    this._freeSlots.length = 0
    this._dirtyRanges.length = 0
    this._slotCount = 0
    this._version += 1
  }

  /**
   * Выполняет внутреннюю операцию ensure slot capacity.
   */
  private ensureSlotCapacity(requiredSlots: number): void {
    if (requiredSlots <= this.slotCapacity) return

    const nextCapacity = Math.max(requiredSlots, this.slotCapacity * 2, 16)
    const next = new Float32Array(nextCapacity * this.strideFloats)
    next.set(this._data)
    this._data = next
  }
}

/**
 * Создает nova render stream id.
 */
export function createNovaRenderStreamId(groupId: NovaRenderGroupId, kind: NovaRenderStreamKind): NovaRenderStreamId {
  return `${groupId}:${kind}`
}

/**
 * Вычисляет nova render stream stride.
 */
export function resolveNovaRenderStreamStride(kind: NovaRenderStreamKind): number {
  switch (kind) {
    case 'plain-rect':
      return 10
    case 'rounded-rect':
      return 16
    case 'motion-rect':
      return 18
    case 'border':
    case 'line':
    case 'arc':
      return 8
    case 'circle':
      return 12
    case 'polygon':
      return 8
    case 'texture-quad':
    case 'icon':
    case 'nine-slice-image':
    case 'cached-group':
      return 10
    case 'text-run':
      return 12
    case 'particle-circle':
      return 12
    case 'particle-sprite':
      return 8
    default:
      return 8
  }
}

/**
 * Вычисляет nova render semantic layer.
 */
export function resolveNovaRenderSemanticLayer(kind: NovaRenderStreamKind): NovaRenderSemanticLayer {
  switch (kind) {
    case 'plain-rect':
    case 'rounded-rect':
    case 'motion-rect':
    case 'circle':
    case 'particle-circle':
    case 'polygon':
      return 'background'
    case 'border':
    case 'line':
    case 'arc':
      return 'border'
    case 'texture-quad':
    case 'icon':
    case 'nine-slice-image':
    case 'cached-group':
    case 'particle-sprite':
      return 'texture'
    case 'text-run':
      return 'text'
    default:
      return 'strict'
  }
}

/**
 * Создает nova batch plan.
 */
export function createNovaBatchPlan(
  groupId: NovaRenderGroupId,
  streams: Iterable<NovaTypedRenderStream>,
  semanticScope?: NovaSemanticScopeKind,
  version = 0,
): NovaBatchPlan {
  const slots = [...streams].flatMap(stream => stream.slots
    .filter(Boolean)
    .map(slot => ({
      stream,
      slot,
      semanticLayer: resolveNovaRenderSemanticLayer(stream.kind),
    })))

  const semanticLayerOrder: Record<NovaRenderSemanticLayer, number> = {
    background: 0,
    border: 1,
    texture: 2,
    text: 3,
    selection: 4,
    overlay: 5,
    strict: 6,
  }

  const canLayer = semanticScope === 'non-overlap-layered' || semanticScope === 'table' || semanticScope === 'timeline-row'
  slots.sort((a, b) => {
    if (canLayer) {
      const layerDiff = semanticLayerOrder[a.semanticLayer] - semanticLayerOrder[b.semanticLayer]
      if (layerDiff !== 0) return layerDiff
      const streamDiff = a.stream.id.localeCompare(b.stream.id)
      if (streamDiff !== 0) return streamDiff
    }

    return a.slot.order - b.slot.order
  })

  const batches: Array<NovaRenderBatch> = []
  for (const current of slots) {
    const last = batches[batches.length - 1]
    if (
      last
      && last.streamId === current.stream.id
      && last.batchKey === current.slot.batchKey
      && last.semanticLayer === current.semanticLayer
      && last.startSlot + last.slotCount === current.slot.offset
    ) {
      last.slotCount += current.slot.count
      last.orderStart = Math.min(last.orderStart, current.slot.order)
      last.orderEnd = Math.max(last.orderEnd, current.slot.order)
      continue
    }

    batches.push({
      id: `${groupId}:batch:${batches.length + 1}`,
      groupId,
      streamId: current.stream.id,
      streamKind: current.stream.kind,
      semanticLayer: current.semanticLayer,
      batchKey: current.slot.batchKey,
      startSlot: current.slot.offset,
      slotCount: current.slot.count,
      orderStart: current.slot.order,
      orderEnd: current.slot.order,
    })
  }

  return {
    id: `${groupId}:batch-plan`,
    groupId,
    semanticScope,
    version,
    batches,
  }
}

/**
 * Объединяет slot dirty ranges.
 */
function mergeSlotDirtyRanges(ranges: Array<NovaRenderStreamDirtyRange>): Array<NovaRenderStreamDirtyRange> {
  if (ranges.length <= 1) return [...ranges]

  const sorted = [...ranges].sort((a, b) => a.startSlot - b.startSlot)
  const merged: Array<NovaRenderStreamDirtyRange> = []

  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (!last || range.startSlot > last.endSlot) {
      merged.push({ ...range })
      continue
    }

    last.endSlot = Math.max(last.endSlot, range.endSlot)
  }

  return merged
}
