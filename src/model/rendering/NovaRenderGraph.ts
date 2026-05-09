import type {
  NovaRenderGroup,
  NovaRenderGroupId,
  NovaRenderHandle,
  NovaRenderItemId,
} from '@/domain/types/rendering/index'

export class NovaRenderGraph {
  readonly groupsById = new Map<NovaRenderGroupId, NovaRenderGroup>()
  readonly groupByNodeId = new Map<string, NovaRenderGroup>()
  readonly handlesByNodeId = new Map<string, NovaRenderHandle[]>()
  readonly handlesByItemId = new Map<NovaRenderItemId, NovaRenderHandle>()
  readonly transformDirtyNodeIds = new Set<string>()
  readonly paintDirtyNodeIds = new Set<string>()
  readonly resourceDirtyNodeIds = new Set<string>()
  readonly visibilityDirtyNodeIds = new Set<string>()

  constructor(readonly surfaceId: string, readonly rootGroup: NovaRenderGroup) {
    this.addGroup(rootGroup)
  }

  addGroup(group: NovaRenderGroup): void {
    this.groupsById.set(group.id, group)
    if (group.ownerNodeId) this.groupByNodeId.set(group.ownerNodeId, group)
  }

  addHandle(handle: NovaRenderHandle): void {
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

  clearDirtyQueues(): void {
    this.transformDirtyNodeIds.clear()
    this.paintDirtyNodeIds.clear()
    this.resourceDirtyNodeIds.clear()
    this.visibilityDirtyNodeIds.clear()
  }
}
