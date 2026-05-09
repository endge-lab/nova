import type {
  NovaBatchPlan,
  NovaRenderGroup,
  NovaRenderGroupId,
  NovaRenderHandle,
  NovaRenderItemId,
  NovaRenderStream,
  NovaRenderStreamId,
  NovaRenderStreamKind,
} from '@/domain/types/rendering/index'
import type { NovaSemanticScopeKind } from '@/domain/types/renderer-types'
import {
  createNovaBatchPlan,
  createNovaRenderStreamId,
  NovaTypedRenderStream,
} from '@/model/rendering/NovaRenderStream'

export class NovaRenderGraph {
  readonly groupsById = new Map<NovaRenderGroupId, NovaRenderGroup>()
  readonly groupByNodeId = new Map<string, NovaRenderGroup>()
  readonly handlesByNodeId = new Map<string, NovaRenderHandle[]>()
  readonly handlesByItemId = new Map<NovaRenderItemId, NovaRenderHandle>()
  readonly streamsByGroupId = new Map<NovaRenderGroupId, Map<NovaRenderStreamId, NovaTypedRenderStream>>()
  readonly batchPlanByGroupId = new Map<NovaRenderGroupId, NovaBatchPlan>()
  readonly transformDirtyNodeIds = new Set<string>()
  readonly paintDirtyNodeIds = new Set<string>()
  readonly resourceDirtyNodeIds = new Set<string>()
  readonly visibilityDirtyNodeIds = new Set<string>()
  readonly childrenDirtyGroupIds = new Set<NovaRenderGroupId>()
  readonly cacheDirtyGroupIds = new Set<NovaRenderGroupId>()

  constructor(readonly surfaceId: string, readonly rootGroup: NovaRenderGroup) {
    this.addGroup(rootGroup)
  }

  addGroup(group: NovaRenderGroup): void {
    this.groupsById.set(group.id, group)
    if (group.ownerNodeId) this.groupByNodeId.set(group.ownerNodeId, group)
    group.streams ??= new Map()
    this.streamsByGroupId.set(group.id, group.streams as Map<NovaRenderStreamId, NovaTypedRenderStream>)
  }

  addHandle(handle: NovaRenderHandle): void {
    const stream = this.ensureStream(handle.groupId, handle.streamKind, handle.streamId)
    const allocation = stream.allocateSlot({
      itemId: handle.itemId,
      count: handle.count,
      order: handle.offset,
      batchKey: handle.batchKey,
      bounds: handle.localBounds,
    })
    handle.offset = allocation.offset
    handle.count = allocation.count
    handle.slotOffset = allocation.offset
    handle.slotCount = allocation.count

    this.handlesByItemId.set(handle.itemId, handle)

    let handles = this.handlesByNodeId.get(handle.nodeId)
    if (!handles) {
      handles = []
      this.handlesByNodeId.set(handle.nodeId, handles)
    }
    handles.push(handle)

    const group = this.groupsById.get(handle.groupId)
    if (!group) return

    if (!group.renderHandlesByNodeId) group.renderHandlesByNodeId = new Map()
    let groupHandles = group.renderHandlesByNodeId.get(handle.nodeId)
    if (!groupHandles) {
      groupHandles = []
      group.renderHandlesByNodeId.set(handle.nodeId, groupHandles)
    }
    groupHandles.push(handle)
  }

  clearHandles(): void {
    this.handlesByNodeId.clear()
    this.handlesByItemId.clear()
    for (const group of this.groupsById.values()) {
      group.renderHandlesByNodeId?.clear()
      group.streams?.forEach(stream => {
        if (stream instanceof NovaTypedRenderStream) stream.clear()
      })
      group.batchPlan = undefined
    }
    this.batchPlanByGroupId.clear()
  }

  replaceHandles(nodeId: string, handles: NovaRenderHandle[]): void {
    for (const handle of this.handlesByNodeId.get(nodeId) ?? []) {
      this.handlesByItemId.delete(handle.itemId)
      const group = this.groupsById.get(handle.groupId)
      group?.renderHandlesByNodeId?.delete(nodeId)
    }

    this.handlesByNodeId.delete(nodeId)
    for (const handle of handles) this.addHandle(handle)
  }

  markTransformDirty(nodeId: string): void {
    this.transformDirtyNodeIds.add(nodeId)
  }

  markPaintDirty(nodeId: string): void {
    this.paintDirtyNodeIds.add(nodeId)
  }

  markResourceDirty(nodeId: string): void {
    this.resourceDirtyNodeIds.add(nodeId)
  }

  markVisibilityDirty(nodeId: string): void {
    this.visibilityDirtyNodeIds.add(nodeId)
  }

  markChildrenDirty(groupId: NovaRenderGroupId): void {
    this.childrenDirtyGroupIds.add(groupId)
  }

  markCacheDirty(groupId: NovaRenderGroupId): void {
    this.cacheDirtyGroupIds.add(groupId)
  }

  ensureStream(
    groupId: NovaRenderGroupId,
    kind: NovaRenderStreamKind,
    streamId: NovaRenderStreamId = createNovaRenderStreamId(groupId, kind),
  ): NovaTypedRenderStream {
    let streams = this.streamsByGroupId.get(groupId)
    const group = this.groupsById.get(groupId)
    if (!streams) {
      streams = new Map()
      this.streamsByGroupId.set(groupId, streams)
      if (group) group.streams = streams as Map<NovaRenderStreamId, NovaRenderStream>
    }

    let stream = streams.get(streamId)
    if (!stream) {
      stream = new NovaTypedRenderStream({ id: streamId, groupId, kind })
      streams.set(streamId, stream)
      if (group) group.streams = streams as Map<NovaRenderStreamId, NovaRenderStream>
    }

    return stream
  }

  rebuildBatchPlan(groupId: NovaRenderGroupId, semanticScope?: NovaSemanticScopeKind): NovaBatchPlan {
    const streams = this.streamsByGroupId.get(groupId)?.values() ?? []
    const current = this.batchPlanByGroupId.get(groupId)
    const next = createNovaBatchPlan(groupId, streams, semanticScope, (current?.version ?? 0) + 1)
    this.batchPlanByGroupId.set(groupId, next)

    const group = this.groupsById.get(groupId)
    if (group) {
      group.batchPlan = next
      group.semanticScope = semanticScope
    }

    return next
  }

  getDirtyHandleCount(): number {
    let total = 0
    for (const nodeId of this.paintDirtyNodeIds) {
      total += this.handlesByNodeId.get(nodeId)?.length ?? 0
    }
    for (const nodeId of this.resourceDirtyNodeIds) {
      total += this.handlesByNodeId.get(nodeId)?.length ?? 0
    }
    return total
  }

  clearDirtyQueues(): void {
    this.transformDirtyNodeIds.clear()
    this.paintDirtyNodeIds.clear()
    this.resourceDirtyNodeIds.clear()
    this.visibilityDirtyNodeIds.clear()
    this.childrenDirtyGroupIds.clear()
    this.cacheDirtyGroupIds.clear()
  }
}
