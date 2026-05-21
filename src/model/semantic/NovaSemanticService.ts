import type {
  NovaSemanticQueryOptions,
  NovaSemanticRegion,
  NovaSemanticRegisterOptions,
  NovaSemanticSnapshot,
  NovaSemanticSnapshotOptions,
} from '@/domain/types/semantic.types'

interface StoredSemanticRegion extends NovaSemanticRegion {
  insertionOrder: number
}

/**
 * Хранит bounded semantic regions без DOM-оверлея и без участия в render hot path.
 */
export class NovaSemanticService {
  private readonly regions = new Map<string, StoredSemanticRegion>()
  private readonly sourceIndex = new Map<string, Set<string>>()
  private insertionCounter = 0
  private autoIdCounter = 0
  private focusedByScope = new Map<string, string>()

  register(options: NovaSemanticRegisterOptions): NovaSemanticRegion {
    const id = options.id ?? `nova-semantic-${++this.autoIdCounter}`
    const previous = this.regions.get(id)
    const insertionOrder = previous?.insertionOrder ?? this.insertionCounter++
    const region: StoredSemanticRegion = {
      id,
      role: options.role,
      label: options.label,
      description: options.description,
      scope: options.scope,
      bounds: cloneBounds(options.bounds),
      focusable: options.focusable ?? false,
      order: options.order ?? insertionOrder,
      state: cloneState(options.state),
      source: options.source ? { ...options.source } : undefined,
      data: options.data ? { ...options.data } : undefined,
      insertionOrder,
    }

    this.removeFromSourceIndex(id)
    this.regions.set(id, region)
    this.addToSourceIndex(region)
    return cloneRegion(region)
  }

  update(id: string, patch: Partial<Omit<NovaSemanticRegisterOptions, 'id'>>): NovaSemanticRegion | undefined {
    const previous = this.regions.get(id)
    if (!previous) return undefined
    const next = this.register({
      id,
      role: patch.role ?? previous.role,
      label: patch.label ?? previous.label,
      description: patch.description ?? previous.description,
      scope: patch.scope ?? previous.scope,
      bounds: patch.bounds ?? previous.bounds,
      focusable: patch.focusable ?? previous.focusable,
      order: patch.order ?? previous.order,
      state: patch.state ?? previous.state,
      source: patch.source ?? previous.source,
      data: patch.data ?? previous.data,
    })
    return next
  }

  remove(id: string): boolean {
    const removed = this.regions.delete(id)
    if (!removed) return false
    this.removeFromSourceIndex(id)
    for (const [scope, focusedId] of this.focusedByScope) {
      if (focusedId === id) this.focusedByScope.delete(scope)
    }
    return true
  }

  clearScope(scope?: string): void {
    if (scope === undefined) {
      this.clear()
      return
    }
    for (const region of this.query({ scope, includeHidden: true, includeDisabled: true })) {
      this.remove(region.id)
    }
  }

  clearSource(sourceKey: string): void {
    const ids = this.sourceIndex.get(sourceKey)
    if (!ids) return
    for (const id of [...ids]) this.remove(id)
    this.sourceIndex.delete(sourceKey)
  }

  syncSource(sourceKey: string, regions: Array<NovaSemanticRegisterOptions>): Array<NovaSemanticRegion> {
    const previousIds = this.sourceIndex.get(sourceKey) ?? new Set<string>()
    const nextIds = new Set<string>()
    const registered: Array<NovaSemanticRegion> = []

    regions.forEach((region, index) => {
      const id = region.id ?? `${sourceKey}:${index}`
      nextIds.add(id)
      registered.push(this.register({
        ...region,
        id,
        source: {
          ...region.source,
          type: region.source?.type ?? 'synthetic',
        },
      }))
    })

    for (const id of previousIds) {
      if (!nextIds.has(id)) this.remove(id)
    }
    this.sourceIndex.set(sourceKey, nextIds)
    return registered
  }

  query(options: NovaSemanticQueryOptions = {}): Array<NovaSemanticRegion> {
    const result: Array<StoredSemanticRegion> = []
    for (const region of this.regions.values()) {
      if (!matchesRegion(region, options)) continue
      result.push(region)
    }
    result.sort(compareRegions)
    const limited = options.maxRegions !== undefined ? result.slice(0, Math.max(0, options.maxRegions)) : result
    return limited.map(cloneRegion)
  }

  snapshot(options: NovaSemanticSnapshotOptions = {}): NovaSemanticSnapshot {
    const includeData = options.includeData ?? true
    const regions = this.query(options).map(region => (
      includeData ? region : { ...region, data: undefined }
    ))
    const focusedId = options.scope !== undefined
      ? this.focusedByScope.get(options.scope)
      : this.findAnyFocusedId()
    return {
      generatedAt: Date.now(),
      regionCount: regions.length,
      focusedId,
      scope: options.scope,
      regions,
    }
  }

  focusNext(options: NovaSemanticQueryOptions = {}): NovaSemanticRegion | undefined {
    return this.moveFocus(options, 1)
  }

  focusPrevious(options: NovaSemanticQueryOptions = {}): NovaSemanticRegion | undefined {
    return this.moveFocus(options, -1)
  }

  getFocused(scope = 'default'): NovaSemanticRegion | undefined {
    const id = this.focusedByScope.get(scope)
    return id ? this.query({ id, includeHidden: true, includeDisabled: true })[0] : undefined
  }

  setFocused(id: string | null, scope = 'default'): NovaSemanticRegion | undefined {
    if (id === null) {
      const previousId = this.focusedByScope.get(scope)
      if (previousId) this.clearRegionFocused(previousId)
      this.focusedByScope.delete(scope)
      return undefined
    }

    const region = this.regions.get(id)
    if (!region || region.state?.hidden || region.state?.disabled || region.focusable === false) return undefined
    const previousId = this.focusedByScope.get(scope)
    if (previousId && previousId !== id) this.clearRegionFocused(previousId)
    this.focusedByScope.set(scope, id)
    this.regions.set(id, {
      ...region,
      state: {
        ...region.state,
        focused: true,
      },
    })
    return cloneRegion(this.regions.get(id)!)
  }

  clear(): void {
    this.regions.clear()
    this.sourceIndex.clear()
    this.focusedByScope.clear()
  }

  reset(): void {
    this.clear()
    this.insertionCounter = 0
    this.autoIdCounter = 0
  }

  private moveFocus(options: NovaSemanticQueryOptions, direction: 1 | -1): NovaSemanticRegion | undefined {
    const scope = options.scope ?? 'default'
    const candidates = this.query({
      ...options,
      focusable: true,
      includeHidden: false,
      includeDisabled: false,
    })
    if (candidates.length === 0) return undefined

    const currentId = this.focusedByScope.get(scope)
    const currentIndex = currentId ? candidates.findIndex(region => region.id === currentId) : -1
    const nextIndex = currentIndex < 0
      ? (direction > 0 ? 0 : candidates.length - 1)
      : (currentIndex + direction + candidates.length) % candidates.length
    return this.setFocused(candidates[nextIndex].id, scope)
  }

  private addToSourceIndex(region: StoredSemanticRegion): void {
    const sourceKey = semanticSourceKey(region)
    if (!sourceKey) return
    let ids = this.sourceIndex.get(sourceKey)
    if (!ids) {
      ids = new Set<string>()
      this.sourceIndex.set(sourceKey, ids)
    }
    ids.add(region.id)
  }

  private removeFromSourceIndex(id: string): void {
    for (const [sourceKey, ids] of this.sourceIndex) {
      ids.delete(id)
      if (ids.size === 0) this.sourceIndex.delete(sourceKey)
    }
  }

  private findAnyFocusedId(): string | undefined {
    for (const id of this.focusedByScope.values()) return id
    return undefined
  }

  private clearRegionFocused(id: string): void {
    const region = this.regions.get(id)
    if (!region?.state?.focused) return
    this.regions.set(id, {
      ...region,
      state: {
        ...region.state,
        focused: false,
      },
    })
  }
}

function matchesRegion(region: StoredSemanticRegion, options: NovaSemanticQueryOptions): boolean {
  if (options.id !== undefined && region.id !== options.id) return false
  if (options.scope !== undefined && region.scope !== options.scope) return false
  if (options.role !== undefined && region.role !== options.role) return false
  if (options.roles !== undefined && !options.roles.includes(region.role)) return false
  if (options.focusable !== undefined && region.focusable !== options.focusable) return false
  if (!options.includeHidden && region.state?.hidden) return false
  if (!options.includeDisabled && region.state?.disabled) return false
  return true
}

function compareRegions(a: StoredSemanticRegion, b: StoredSemanticRegion): number {
  const orderDiff = a.order - b.order
  if (orderDiff !== 0) return orderDiff
  return a.insertionOrder - b.insertionOrder
}

function cloneRegion(region: StoredSemanticRegion | NovaSemanticRegion): NovaSemanticRegion {
  return {
    id: region.id,
    role: region.role,
    label: region.label,
    description: region.description,
    scope: region.scope,
    bounds: cloneBounds(region.bounds),
    focusable: region.focusable,
    order: region.order,
    state: cloneState(region.state),
    source: region.source ? { ...region.source } : undefined,
    data: region.data ? { ...region.data } : undefined,
  }
}

function cloneBounds(bounds: NovaSemanticRegion['bounds']): NovaSemanticRegion['bounds'] {
  return bounds ? { ...bounds } : undefined
}

function cloneState(state: NovaSemanticRegion['state']): NovaSemanticRegion['state'] {
  return state ? { ...state } : undefined
}

function semanticSourceKey(region: NovaSemanticRegion): string | undefined {
  const source = region.source
  if (!source) return undefined
  return [
    source.type ?? 'custom',
    source.nodeId ?? '',
    source.componentId ?? '',
    source.part ?? '',
  ].join(':')
}
